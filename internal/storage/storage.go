// Package storage is the DuckDB-backed telemetry store described in
// docs/design/duckdb-storage.md: schema/migrations, ingest (conversion + the
// single writer goroutine + Appender batching), the retention/max_size
// sweep, and the read query layer. It is wired into cmd/, the OTLP exporter,
// and GraphQL/WebSocket (via internal/broadcast) as the sole store — the
// ring-buffer store package this replaced is gone (Phase 5).
package storage

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	duckdb "github.com/duckdb/duckdb-go/v2"
	"github.com/mashiro/otelop/internal/selftelemetry"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/attribute"
)

const (
	defaultRetention = 7 * 24 * time.Hour
	defaultMaxSize   = 4 << 30 // 4 GiB

	// writeQueueSize bounds the channel between AddX callers and the writer
	// goroutine. Sized to absorb a burst without blocking OTLP receivers;
	// once full, AddX drops the batch (see enqueueDrop) rather than
	// backpressuring ingest — the same policy internal/websocket's hub
	// applies to slow broadcast consumers.
	writeQueueSize = 1024

	// resourceCacheCap bounds the in-writer LRU of known resource_hash
	// values. It is a pure cache (see lruSet) so its size only trades off
	// memory against how often a well-known resource still takes the
	// INSERT ... ON CONFLICT DO NOTHING round trip.
	resourceCacheCap = 10_000

	// commitQueueSize bounds the channel handing CommitEvents from the
	// writer goroutine to the dedicated OnCommit-delivery goroutine (see
	// Options.OnCommit). Sized the same as writeQueueSize and for the same
	// reason: absorb a burst without making the writer wait on a slow
	// listener; once full, the newest event is dropped (see dispatchCommit).
	commitQueueSize = 256
	// metricCommitBatchSize caps how many adjacent metric commit events the
	// optional batch delivery callback may derive in one read-back query.
	// The cap avoids trading query overhead for an unbounded in-memory result.
	metricCommitBatchSize = 16

	// sweepInterval is how often the background retention/max_size sweep
	// runs, matching docs/design/duckdb-storage.md's "hourly sweep".
	sweepInterval = time.Hour

	// maxSizeSweepIterations bounds how many "delete the oldest day" passes
	// enforceMaxSize will attempt in one call. It's a hard stop so a
	// pathological max_size (smaller than DuckDB's fixed per-file overhead)
	// can't spin forever; the sweep just logs a warning and gives up for
	// this pass, trying again next hour.
	maxSizeSweepIterations = 60

	// New Relic caps a trace view at 10,000 spans. Traces larger than that
	// are not useful to otelop's trace UI and make every live summary update
	// progressively more expensive, so ingestion drops and tombstones them.
	maxSpansPerTrace = 10_000
)

// Options configures Open.
type Options struct {
	// Path is the database file location. Empty means an in-memory database
	// — used by tests, and by any future in-process caller that wants a
	// throwaway store.
	Path string
	// Retention is how far back fact rows (spans, metric_points, logs) are
	// kept. Defaults to 7 days.
	Retention time.Duration
	// MaxSize is the on-disk ceiling in bytes for a file-backed database.
	// Ignored for in-memory databases. Defaults to 4 GiB.
	MaxSize int64
	// OnCommit, if set, is invoked once per flushed batch after its fact rows
	// are durably written — see docs/design/duckdb-storage.md's ingest step 4
	// ("after flush, invoke onAdd ... to feed the WebSocket hub, mirroring
	// the previous store's contract"). Unlike a direct call from the writer
	// goroutine, delivery runs on its own dedicated goroutine (started by
	// Open) reached through a bounded channel (commitQueueSize): a slow
	// listener (e.g. internal/broadcast's conversion + hub fan-out) never
	// blocks subsequent ingest. Events are delivered in commit order; if the
	// listener falls behind enough to fill the channel, the newest event is
	// dropped with a logged warning — the same drop-on-full policy the write
	// queue applies — rather than blocking the writer. Close waits for every
	// already-queued event to be delivered before returning.
	OnCommit OnCommitFunc
	// OnCommitBatch is the batch-aware alternative used by the WebSocket
	// broadcaster. When set, adjacent metric commits are delivered together
	// (up to metricCommitBatchSize); other signals remain one item per call.
	// OnCommit and OnCommitBatch are mutually exclusive.
	OnCommitBatch OnCommitBatchFunc
}

// SignalKind identifies which fact table a CommitEvent covers.
type SignalKind int

const (
	KindTraces SignalKind = iota
	KindMetrics
	KindLogs
)

// CommitEvent describes one flushed batch — enough for a listener (see
// internal/broadcast) to look up what changed via the read query API without
// re-deriving it from raw rows itself.
type CommitEvent struct {
	Kind SignalKind
	// Traces contains the newly-appended, deduped spans plus their committed
	// summaries when Kind == KindTraces.
	Traces TraceBatch
	// Metrics is populated (series metadata for every series referenced by
	// Points, plus the newly-appended points) when Kind == KindMetrics.
	Metrics MetricBatch
	// Logs is populated (resources plus the newly-appended log rows) when Kind == KindLogs.
	Logs LogBatch
}

// OnCommitFunc is the type of Options.OnCommit.
type OnCommitFunc func(ctx context.Context, ev CommitEvent)

// CommitDelivery preserves each event's ingest context when multiple metric
// commits share one delivery callback.
type CommitDelivery struct {
	Ctx   context.Context
	Event CommitEvent
}

// OnCommitBatchFunc receives commit-ordered deliveries. A call contains
// either one non-metric event or up to metricCommitBatchSize adjacent metric
// events.
type OnCommitBatchFunc func(deliveries []CommitDelivery)

// commitJob is what flows through Storage.commitCh. barrier is non-nil only
// for the internal "has everything enqueued so far been delivered" probe
// awaitCommitDrain uses (Sync's synchronization with the delivery
// goroutine); ev is meaningless in that case and is left zero-valued.
type commitJob struct {
	ctx        context.Context
	enqueuedAt time.Time
	ev         CommitEvent
	barrier    chan struct{}
}

// writerMsgKind tags a message sent to the writer goroutine.
type writerMsgKind int

const (
	msgTraces writerMsgKind = iota
	msgMetrics
	msgLogs
	msgSync
	msgSweep
	msgClear
)

// writerMsg is the single message type flowing through Storage.queue. Sync
// and Sweep set done so the caller can block until the writer has processed
// (or, for Sweep, actually run) the request; AddX messages leave done nil.
type writerMsg struct {
	ctx        context.Context
	enqueuedAt time.Time
	kind       writerMsgKind
	traces     TraceBatch
	metrics    MetricBatch
	logs       LogBatch
	done       chan error
}

// Storage is the DuckDB-backed telemetry store. A single writer goroutine
// owns the write connection and all mutating SQL; Open also exposes the
// general connection pool (DB) for read queries, matching the design's
// "single writer, separate read connections" split.
type Storage struct {
	opts Options

	connector *duckdb.Connector
	db        *sql.DB
	writer    *sql.Conn // exclusively used by the run() goroutine

	// mu guards the closed flag against the enqueue-vs-Close race: Close
	// must not close(queue) while an AddX/Sync/Sweep call is mid-send, since
	// sending on a closed channel panics. Every enqueue path takes RLock
	// for the whole "check closed, send" sequence; Close takes Lock before
	// flipping closed and closing the channel, so no sender can be
	// in-flight when the channel closes.
	mu     sync.RWMutex
	closed bool
	queue  chan writerMsg
	wg     sync.WaitGroup

	// resourceCache is a pure cache: a miss repeats an idempotent upsert.
	resourceCache *lruSet[uint64]

	sweepTicker *time.Ticker
	sweepStop   chan struct{}

	// commitCh hands CommitEvents from the writer goroutine to runCommits,
	// the dedicated goroutine that actually invokes opts.OnCommit — see
	// Options.OnCommit's doc comment. Non-nil only when opts.OnCommit is
	// set; commitWG lets Close wait for runCommits to drain it before
	// returning.
	commitCh chan commitJob
	commitWG sync.WaitGroup

	// sizeFn reports the database file's current on-disk size; enforceMaxSize
	// calls it, defaulting to fileSize. Overridable so tests can drive the
	// "delete oldest day until under the ceiling" loop deterministically
	// without depending on exactly how much DuckDB's file shrinks after a
	// DELETE + CHECKPOINT (which — see enforceMaxSize's comment — it may not
	// do promptly at all).
	sizeFn func() (int64, error)

	// traceByIDCalls counts TraceByID invocations — one SQL round trip each.
	// It exists so the GraphQL layer's tests can assert the trace-list N+1
	// regression (a single Query.traces resolving hundreds of per-trace
	// TraceByID calls — see internal/graphql/trace_resolver_test.go) stays
	// fixed, without needing a mock storage layer.
	traceByIDCalls atomic.Int64
	telemetry      atomic.Pointer[storageTelemetry]
}

// Open creates or opens a DuckDB database at opts.Path (or an in-memory
// database if empty), applies schema migrations, and starts the writer and
// sweep goroutines.
func Open(ctx context.Context, opts Options) (*Storage, error) {
	if opts.OnCommit != nil && opts.OnCommitBatch != nil {
		return nil, errors.New("storage: OnCommit and OnCommitBatch are mutually exclusive")
	}
	if opts.Retention <= 0 {
		opts.Retention = defaultRetention
	}
	if opts.MaxSize <= 0 {
		opts.MaxSize = defaultMaxSize
	}

	connector, err := duckdb.NewConnector(opts.Path, nil)
	if err != nil {
		return nil, fmt.Errorf("storage: open connector: %w", err)
	}
	db := sql.OpenDB(connector)

	if err := migrate(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}

	writerConn, err := db.Conn(ctx)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("storage: reserve writer connection: %w", err)
	}
	if _, err := writerConn.ExecContext(ctx, `
		CREATE TEMP TABLE metric_series_staging AS
		SELECT * FROM metric_series WHERE false;
		CREATE TEMP TABLE histogram_layouts_staging AS
		SELECT * FROM histogram_layouts WHERE false;
	`); err != nil {
		_ = writerConn.Close()
		_ = db.Close()
		return nil, fmt.Errorf("storage: prepare metric staging tables: %w", err)
	}
	s := &Storage{
		opts:          opts,
		connector:     connector,
		db:            db,
		writer:        writerConn,
		queue:         make(chan writerMsg, writeQueueSize),
		resourceCache: newLRUSet[uint64](resourceCacheCap),
		sweepStop:     make(chan struct{}),
	}
	s.sizeFn = s.fileSize

	if opts.OnCommit != nil || opts.OnCommitBatch != nil {
		s.commitCh = make(chan commitJob, commitQueueSize)
		s.commitWG.Add(1)
		go s.runCommits()
	}

	s.wg.Add(1)
	go s.run()

	s.sweepTicker = time.NewTicker(sweepInterval)
	s.wg.Add(1)
	go s.sweepLoop()

	return s, nil
}

// DB returns the general-purpose read connection pool backing the query
// layer (internal/storage's query_*.go files); it's also the seam tests use
// to verify ingested rows directly.
func (s *Storage) DB() *sql.DB { return s.db }

// AddTraces converts td and enqueues it for the writer. Converting outside
// the writer goroutine keeps pdata processing (which can run concurrently
// with other batches) off the single serialized write path.
func (s *Storage) AddTraces(ctx context.Context, td ptrace.Traces) {
	if selftelemetry.TracesAreInternal(td) {
		ctx = suppressTracing(ctx)
	}
	ctx, span := startStorageSpan(ctx, "storage.AddTraces")
	defer span.End()
	_, convertSpan := startStorageSpan(ctx, "storage.ConvertTraces")
	batch := ConvertTraces(td)
	convertSpan.SetAttributes(attribute.Int("storage.batch.resources", len(batch.Resources)), attribute.Int("storage.batch.rows", len(batch.Spans)))
	convertSpan.End()
	if len(batch.Resources) == 0 && len(batch.Spans) == 0 {
		return
	}
	s.enqueue(writerMsg{ctx: context.WithoutCancel(ctx), enqueuedAt: time.Now(), kind: msgTraces, traces: batch}, "traces")
}

// AddMetrics converts md and enqueues it for the writer.
func (s *Storage) AddMetrics(ctx context.Context, md pmetric.Metrics) {
	if selftelemetry.MetricsAreInternal(md) {
		ctx = suppressTracing(ctx)
	}
	ctx, span := startStorageSpan(ctx, "storage.AddMetrics")
	defer span.End()
	_, convertSpan := startStorageSpan(ctx, "storage.ConvertMetrics")
	batch := ConvertMetrics(md)
	convertSpan.SetAttributes(attribute.Int("storage.batch.resources", len(batch.Resources)), attribute.Int("storage.batch.series", len(batch.Series)), attribute.Int("storage.batch.rows", len(batch.Points)))
	convertSpan.End()
	if len(batch.Series) == 0 && len(batch.Points) == 0 {
		return
	}
	s.enqueue(writerMsg{ctx: context.WithoutCancel(ctx), enqueuedAt: time.Now(), kind: msgMetrics, metrics: batch}, "metrics")
}

// AddLogs converts ld and enqueues it for the writer.
func (s *Storage) AddLogs(ctx context.Context, ld plog.Logs) {
	if selftelemetry.LogsAreInternal(ld) {
		ctx = suppressTracing(ctx)
	}
	ctx, span := startStorageSpan(ctx, "storage.AddLogs")
	defer span.End()
	_, convertSpan := startStorageSpan(ctx, "storage.ConvertLogs")
	batch := ConvertLogs(ld)
	convertSpan.SetAttributes(attribute.Int("storage.batch.resources", len(batch.Resources)), attribute.Int("storage.batch.rows", len(batch.Logs)))
	convertSpan.End()
	if len(batch.Resources) == 0 && len(batch.Logs) == 0 {
		return
	}
	s.enqueue(writerMsg{ctx: context.WithoutCancel(ctx), enqueuedAt: time.Now(), kind: msgLogs, logs: batch}, "logs")
}

// enqueue submits msg to the writer, dropping it (with a warning) if the
// queue is full. This is the same backpressure policy internal/websocket's
// hub applies: a slow/stuck writer degrades ingest by dropping the newest
// data rather than blocking the OTLP receiver pipeline.
func (s *Storage) enqueue(msg writerMsg, what string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return
	}
	select {
	case s.queue <- msg:
	default:
		s.recordQueueDrop(context.Background(), "write", what)
		slog.Warn("storage: write queue full, dropping batch", "signal", what)
	}
}

// enqueueBlocking submits a control message (Sync/Sweep) that must never be
// silently dropped — unlike AddX batches, callers are explicitly waiting on
// msg.done. It still respects the closed flag so a call racing Close is a
// safe no-op rather than a send on a soon-to-be-closed channel.
func (s *Storage) enqueueBlocking(msg writerMsg) bool {
	if msg.ctx == nil {
		msg.ctx = context.Background()
	}
	if msg.enqueuedAt.IsZero() {
		msg.enqueuedAt = time.Now()
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return false
	}
	s.queue <- msg
	return true
}

// Sync blocks until the writer has processed every batch enqueued before
// this call. Intended for tests: AddTraces/AddMetrics/AddLogs return as soon
// as the batch is queued, so assertions against the database need a barrier.
func (s *Storage) Sync() {
	done := make(chan error, 1)
	if !s.enqueueBlocking(writerMsg{kind: msgSync, done: done}) {
		return
	}
	<-done
}

// Sweep runs one retention+max_size pass synchronously on the writer
// connection and returns any error. Exported so tests can trigger a sweep
// deterministically instead of waiting for the hourly ticker; the ticker
// calls this exact method.
func (s *Storage) Sweep(ctx context.Context) error {
	done := make(chan error, 1)
	if !s.enqueueBlocking(writerMsg{kind: msgSweep, done: done}) {
		return errors.New("storage: closed")
	}
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Clear deletes every row from every table (dimensions and facts alike),
// resets the in-writer caches, and checkpoints — the storage-backed
// replacement for the old store package's Store.Clear, exposed as the
// clearSignals GraphQL mutation. Serialized through the writer goroutine so
// it can never race an in-flight append.
func (s *Storage) Clear(ctx context.Context) error {
	done := make(chan error, 1)
	if !s.enqueueBlocking(writerMsg{kind: msgClear, done: done}) {
		return errors.New("storage: closed")
	}
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Close stops accepting new work, drains everything already queued, and
// releases the database connections. Batches enqueued before Close is
// called are guaranteed to be written; Close does not cancel in-flight work.
// If OnCommit is set, Close also waits for every CommitEvent already handed
// to the delivery goroutine (see Options.OnCommit) to actually be
// delivered — including ones dispatched from a batch this same Close call
// is draining — before returning, in commit order.
func (s *Storage) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	close(s.queue)
	s.mu.Unlock()

	s.sweepTicker.Stop()
	close(s.sweepStop)

	s.wg.Wait() // run() drains the closed channel; sweepLoop exits on sweepStop

	if s.commitCh != nil {
		// Only safe to close now that run() — commitCh's sole sender — has
		// exited above; closing while it could still send would panic. The
		// dedicated delivery goroutine drains whatever is left (in commit
		// order) before exiting, and commitWG.Wait blocks Close on that.
		close(s.commitCh)
		s.commitWG.Wait()
	}

	var errs []error
	if err := s.writer.Close(); err != nil {
		errs = append(errs, fmt.Errorf("storage: close writer conn: %w", err))
	}
	if err := s.db.Close(); err != nil {
		errs = append(errs, fmt.Errorf("storage: close db: %w", err))
	}
	return errors.Join(errs...)
}

// run is the single writer goroutine. It owns s.writer exclusively, so
// every mutating statement — Appender batches and dimension upserts alike —
// is naturally serialized without extra locking.
func (s *Storage) run() {
	defer s.wg.Done()
	for msg := range s.queue {
		ctx := msg.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		if msg.kind == msgTraces || msg.kind == msgMetrics || msg.kind == msgLogs {
			_, queueSpan := startStorageSpan(ctx, "storage.queue.wait",
				attribute.String("storage.signal", writerMsgSignal(msg.kind)),
				attribute.Float64("storage.queue.wait_ms", float64(time.Since(msg.enqueuedAt).Microseconds())/1000))
			queueSpan.End()
		}
		switch msg.kind {
		case msgTraces:
			s.writeTraces(ctx, msg.traces)
		case msgMetrics:
			s.writeMetrics(ctx, msg.metrics)
		case msgLogs:
			s.writeLogs(ctx, msg.logs)
		case msgSync:
			// Sync's contract is "every batch enqueued before this call has
			// been fully processed" — extended here to also cover OnCommit
			// delivery (not just the write itself), since Sync is the
			// barrier tests use to make async delivery deterministic.
			s.awaitCommitDrain()
			msg.done <- nil
		case msgSweep:
			msg.done <- s.performSweep(ctx)
		case msgClear:
			msg.done <- s.performClear(ctx)
		}
	}
}

// awaitCommitDrain blocks until every CommitEvent dispatched so far (from
// this same writer goroutine, strictly before this call) has been delivered
// by runCommits. It works by enqueuing a barrier job behind them on the same
// FIFO channel and waiting for runCommits to reach it — since runCommits
// processes one job at a time, reaching the barrier means the job right
// before it has already been fully delivered. Unlike dispatchCommit this
// send is blocking/undroppable: a barrier silently dropped would hang the
// caller (Sync) forever.
func (s *Storage) awaitCommitDrain() {
	if s.commitCh == nil {
		return
	}
	barrier := make(chan struct{})
	s.commitCh <- commitJob{ctx: context.Background(), barrier: barrier}
	<-barrier
}

// dispatchCommit hands ev to the dedicated delivery goroutine (see
// Options.OnCommit), dropping it with a warning if that goroutine has fallen
// far enough behind to fill commitCh — the same drop-on-full policy enqueue
// applies to the write queue — rather than blocking the writer goroutine on
// a slow listener.
func (s *Storage) dispatchCommit(ctx context.Context, ev CommitEvent) {
	if s.commitCh == nil {
		return
	}
	select {
	case s.commitCh <- commitJob{ctx: ctx, enqueuedAt: time.Now(), ev: ev}:
	default:
		s.recordQueueDrop(context.Background(), "commit", signalKindName(ev.Kind))
		slog.Warn("storage: commit event queue full, dropping broadcast", "kind", ev.Kind)
	}
}

// runCommits is the dedicated OnCommit-delivery goroutine (see
// Options.OnCommit's doc comment): it owns nothing but commitCh, so a slow
// opts.OnCommit call here never blocks the writer goroutine dispatching the
// next batch. Processing one job at a time off a single channel is what
// gives delivery its commit-order guarantee and lets awaitCommitDrain's
// barrier trick work.
func (s *Storage) runCommits() {
	defer s.commitWG.Done()
	var pending *commitJob
	for {
		var job commitJob
		var ok bool
		if pending != nil {
			job = *pending
			pending = nil
			ok = true
		} else {
			job, ok = <-s.commitCh
		}
		if !ok {
			return
		}
		if job.barrier != nil {
			close(job.barrier)
			continue
		}
		if s.opts.OnCommitBatch != nil {
			jobs := []commitJob{job}
			if job.ev.Kind == KindMetrics {
			drainMetrics:
				for len(jobs) < metricCommitBatchSize {
					select {
					case next, open := <-s.commitCh:
						if !open {
							s.deliverCommitBatch(jobs)
							return
						}
						if next.barrier != nil || next.ev.Kind != KindMetrics {
							pending = &next
							break drainMetrics
						}
						jobs = append(jobs, next)
					default:
						break drainMetrics
					}
				}
			}
			s.deliverCommitBatch(jobs)
			continue
		}
		ctx := job.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		ctx, span := startStorageSpan(ctx, "storage.deliverCommit",
			attribute.String("storage.signal", signalKindName(job.ev.Kind)),
			attribute.Float64("storage.queue.wait_ms", float64(time.Since(job.enqueuedAt).Microseconds())/1000))
		started := time.Now()
		s.opts.OnCommit(ctx, job.ev)
		s.recordCommit(ctx, signalKindName(job.ev.Kind), started)
		span.End()
	}
}

func (s *Storage) deliverCommitBatch(jobs []commitJob) {
	ctx := jobs[0].ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, span := startStorageSpan(ctx, "storage.deliverCommitBatch",
		attribute.String("storage.signal", signalKindName(jobs[0].ev.Kind)),
		attribute.Int("storage.batch.commits", len(jobs)),
		attribute.Float64("storage.queue.wait_ms", float64(time.Since(jobs[0].enqueuedAt).Microseconds())/1000))
	started := time.Now()
	deliveries := make([]CommitDelivery, len(jobs))
	for i, job := range jobs {
		jobCtx := job.ctx
		if jobCtx == nil {
			jobCtx = context.Background()
		}
		deliveries[i] = CommitDelivery{Ctx: jobCtx, Event: job.ev}
	}
	s.opts.OnCommitBatch(deliveries)
	s.recordCommit(ctx, signalKindName(jobs[0].ev.Kind), started)
	span.End()
}

// sweepLoop runs the periodic retention/max_size sweep. It goes through the
// same Sweep/enqueue path as a manual call so periodic and test-triggered
// sweeps share one code path and stay serialized with ingest on the writer
// connection.
func (s *Storage) sweepLoop() {
	defer s.wg.Done()
	for {
		select {
		case <-s.sweepTicker.C:
			if err := s.Sweep(context.Background()); err != nil {
				slog.Error("storage: periodic sweep failed", "error", err)
			}
		case <-s.sweepStop:
			return
		}
	}
}

// writeTraces upserts the batch's resource rows, filters recently seen spans,
// and atomically merges new spans with their derived trace summaries.
func (s *Storage) writeTraces(ctx context.Context, batch TraceBatch) {
	ctx, span := startStorageSpan(ctx, "storage.writeTraces",
		attribute.Int("storage.batch.rows", len(batch.Spans)),
		attribute.Int("storage.batch.resources", len(batch.Resources)))
	defer span.End()
	started := time.Now()
	var written int64
	defer func() { s.recordWrite(ctx, "traces", started, written) }()

	if err := s.upsertResources(ctx, batch.Resources); err != nil {
		slog.Error("storage: upsert resources failed", "error", err)
		return
	}
	rows, err := s.filterDroppedTraceRows(ctx, batch.Spans)
	if err != nil {
		slog.Error("storage: filter dropped traces failed", "error", err)
		return
	}
	if len(rows) == 0 {
		return
	}

	now := time.Now()
	_, persistSpan := startStorageSpan(ctx, "storage.persistTraceBatch", attribute.Int("db.rows", len(rows)))
	kept, summaries, droppedTraceIDs, err := s.writeTraceRowsTransaction(ctx, rows, now)
	endStorageSpan(persistSpan, err)
	if err != nil {
		slog.Error("storage: persist trace batch failed", "error", err)
		return
	}
	written = int64(len(kept))
	s.dispatchCommit(ctx, CommitEvent{Kind: KindTraces, Traces: TraceBatch{
		Resources: batch.Resources, Spans: kept, Summaries: summaries, DroppedTraceIDs: droppedTraceIDs,
	}})
}

// filterDroppedTraceRows is deliberately before span-ID cache loading.
// Tombstoned traces must not spend an indexed lookup or occupy a cache entry.
func (s *Storage) filterDroppedTraceRows(ctx context.Context, rows []SpanRow) ([]SpanRow, error) {
	if len(rows) == 0 {
		return rows, nil
	}
	traceIDs := distinctTraceIDsForRows(rows)
	marks := strings.TrimSuffix(strings.Repeat("?,", len(traceIDs)), ",")
	traceArgs := make([]any, len(traceIDs))
	for i, traceID := range traceIDs {
		traceArgs[i] = traceID
	}

	tombstoned := make(map[string]struct{})
	droppedRows, err := s.writer.QueryContext(ctx,
		`SELECT trace_id FROM dropped_traces WHERE trace_id IN (`+marks+`)`, traceArgs...)
	if err != nil {
		return nil, fmt.Errorf("storage: query dropped traces: %w", err)
	}
	for droppedRows.Next() {
		var traceID string
		if err := droppedRows.Scan(&traceID); err != nil {
			_ = droppedRows.Close()
			return nil, fmt.Errorf("storage: scan dropped trace: %w", err)
		}
		tombstoned[traceID] = struct{}{}
	}
	if err := droppedRows.Err(); err != nil {
		_ = droppedRows.Close()
		return nil, fmt.Errorf("storage: iterate dropped traces: %w", err)
	}
	if err := droppedRows.Close(); err != nil {
		return nil, fmt.Errorf("storage: close dropped traces: %w", err)
	}
	if len(tombstoned) == 0 {
		return rows, nil
	}

	if _, err := s.writer.ExecContext(ctx,
		`UPDATE dropped_traces SET last_seen = ? WHERE trace_id IN (`+marks+`)`,
		append([]any{time.Now()}, traceArgs...)...); err != nil {
		return nil, fmt.Errorf("storage: refresh dropped traces: %w", err)
	}
	result := make([]SpanRow, 0, len(rows))
	for _, row := range rows {
		if _, dropped := tombstoned[row.TraceID]; !dropped {
			result = append(result, row)
		}
	}
	return result, nil
}

func distinctTraceIDsForRows(rows []SpanRow) []string {
	seen := make(map[string]struct{}, len(rows))
	result := make([]string, 0, len(rows))
	for _, row := range rows {
		if _, found := seen[row.TraceID]; found {
			continue
		}
		seen[row.TraceID] = struct{}{}
		result = append(result, row.TraceID)
	}
	return result
}

// writeMetrics upserts the batch's resource rows and series metadata, then
// appends every point.
func (s *Storage) writeMetrics(ctx context.Context, batch MetricBatch) {
	ctx, span := startStorageSpan(ctx, "storage.writeMetrics",
		attribute.Int("storage.batch.rows", len(batch.Points)),
		attribute.Int("storage.batch.exemplars", len(batch.Exemplars)),
		attribute.Int("storage.batch.series", len(batch.Series)),
		attribute.Int("storage.batch.resources", len(batch.Resources)))
	defer span.End()
	started := time.Now()
	var written int64
	defer func() { s.recordWrite(ctx, "metrics", started, written) }()
	if _, err := s.writer.ExecContext(ctx, `BEGIN TRANSACTION`); err != nil {
		slog.Error("storage: begin metrics transaction failed", "error", err)
		return
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = s.writer.ExecContext(context.Background(), `ROLLBACK`)
			// upsertResources populates this cache before COMMIT. A later
			// point/exemplar failure rolls the row back, so retain no cache
			// entries that could suppress its next insert.
			s.resourceCache = newLRUSet[uint64](resourceCacheCap)
		}
	}()

	if err := s.upsertResources(ctx, batch.Resources); err != nil {
		slog.Error("storage: upsert resources failed", "error", err)
		return
	}
	if err := s.upsertSeries(ctx, batch.Series); err != nil {
		slog.Error("storage: upsert metric series failed", "error", err)
		return
	}
	if err := s.upsertHistogramLayouts(ctx, batch.HistogramLayouts); err != nil {
		slog.Error("storage: upsert histogram layouts failed", "error", err)
		return
	}
	if len(batch.Points) == 0 {
		if _, err := s.writer.ExecContext(ctx, `COMMIT`); err != nil {
			slog.Error("storage: commit metric dimensions failed", "error", err)
			return
		}
		committed = true
		return
	}

	ingestedAt := time.Now()
	_, appendSpan := startStorageSpan(ctx, "storage.appendMetricPoints", attribute.Int("db.rows", len(batch.Points)))
	err := s.writer.Raw(func(driverConn any) error {
		conn := driverConn.(driver.Conn)
		appender, err := duckdb.NewAppenderWithColumns(conn, "", "", "metric_points", []string{
			"id", "series_key", "ts", "start_ts", "ingested_at", "flags",
			"value_int", "value_double", "count", "sum", "min", "max", "histogram_layout_hash",
			"bucket_counts", "zero_count", "positive_offset", "positive_bucket_counts",
			"negative_offset", "negative_bucket_counts", "summary_quantiles", "summary_quantile_values",
		})
		if err != nil {
			return err
		}
		defer func() { _ = appender.Close() }()

		for _, p := range batch.Points {
			if err := appender.AppendRow(
				duckdb.UUID(p.ID),
				p.SeriesKey,
				p.TS,
				timeArg(p.StartTS),
				ingestedAt,
				p.Flags,
				int64Arg(p.ValueInt),
				floatArg(p.ValueDouble),
				uint64Arg(p.Count),
				floatArg(p.Sum),
				floatArg(p.Min),
				floatArg(p.Max),
				uint64Arg(p.HistogramLayoutHash),
				p.BucketCounts,
				uint64Arg(p.ZeroCount),
				int32Arg(p.PositiveOffset),
				p.PositiveBucketCounts,
				int32Arg(p.NegativeOffset),
				p.NegativeBucketCounts,
				p.SummaryQuantiles,
				p.SummaryQuantileValues,
			); err != nil {
				return err
			}
		}
		if err := appender.Flush(); err != nil {
			return err
		}
		if len(batch.Exemplars) == 0 {
			return nil
		}
		exemplarAppender, err := duckdb.NewAppenderWithColumns(conn, "", "", "metric_exemplars", []string{
			"id", "point_id", "ts", "trace_id", "span_id", "filtered_attributes", "filtered_attributes_raw",
			"value_int", "value_double",
		})
		if err != nil {
			return err
		}
		defer func() { _ = exemplarAppender.Close() }()
		for _, exemplar := range batch.Exemplars {
			if err := exemplarAppender.AppendRow(
				duckdb.UUID(exemplar.ID), duckdb.UUID(exemplar.PointID), exemplar.TS,
				exemplar.TraceID, exemplar.SpanID, exemplar.FilteredAttributes,
				exemplar.FilteredAttributesRaw,
				int64Arg(exemplar.ValueInt), floatArg(exemplar.ValueDouble),
			); err != nil {
				return err
			}
		}
		return exemplarAppender.Flush()
	})
	endStorageSpan(appendSpan, err)
	if err != nil {
		slog.Error("storage: append metric points failed", "error", err)
		return
	}
	if _, err := s.writer.ExecContext(ctx, `COMMIT`); err != nil {
		slog.Error("storage: commit metric batch failed", "error", err)
		return
	}
	committed = true
	written = int64(len(batch.Points))
	s.dispatchCommit(ctx, CommitEvent{Kind: KindMetrics, Metrics: batch})
}

func (s *Storage) upsertHistogramLayouts(ctx context.Context, rows []HistogramLayoutRow) error {
	if len(rows) == 0 {
		return nil
	}
	if _, err := s.writer.ExecContext(ctx, `DELETE FROM histogram_layouts_staging`); err != nil {
		return fmt.Errorf("storage: clear histogram layout staging table: %w", err)
	}
	err := s.writer.Raw(func(driverConn any) error {
		appender, appendErr := duckdb.NewAppenderWithColumns(driverConn.(driver.Conn), "", "", "histogram_layouts_staging", []string{
			"layout_hash", "kind", "explicit_bounds", "scale", "zero_threshold",
		})
		if appendErr != nil {
			return appendErr
		}
		defer func() { _ = appender.Close() }()
		for _, row := range rows {
			if appendErr := appender.AppendRow(
				row.LayoutHash, row.Kind, row.ExplicitBounds, int32Arg(row.Scale), floatArg(row.ZeroThreshold),
			); appendErr != nil {
				return appendErr
			}
		}
		return appender.Flush()
	})
	if err != nil {
		return fmt.Errorf("storage: stage histogram layouts: %w", err)
	}
	_, err = s.writer.ExecContext(ctx, `
		MERGE INTO histogram_layouts AS target
		USING histogram_layouts_staging AS incoming
		ON target.layout_hash = incoming.layout_hash
		WHEN NOT MATCHED THEN INSERT (layout_hash, kind, explicit_bounds, scale, zero_threshold)
		VALUES (incoming.layout_hash, incoming.kind, incoming.explicit_bounds, incoming.scale, incoming.zero_threshold)
	`)
	if err != nil {
		return fmt.Errorf("storage: merge histogram layouts: %w", err)
	}
	return nil
}

// writeLogs upserts the batch's resource rows, then appends every log.
func (s *Storage) writeLogs(ctx context.Context, batch LogBatch) {
	ctx, span := startStorageSpan(ctx, "storage.writeLogs",
		attribute.Int("storage.batch.rows", len(batch.Logs)),
		attribute.Int("storage.batch.resources", len(batch.Resources)))
	defer span.End()
	started := time.Now()
	var written int64
	defer func() { s.recordWrite(ctx, "logs", started, written) }()

	if err := s.upsertResources(ctx, batch.Resources); err != nil {
		slog.Error("storage: upsert resources failed", "error", err)
		return
	}
	if len(batch.Logs) == 0 {
		return
	}

	now := time.Now()
	_, appendSpan := startStorageSpan(ctx, "storage.appendLogs", attribute.Int("db.rows", len(batch.Logs)))
	err := s.writer.Raw(func(driverConn any) error {
		appender, err := duckdb.NewAppenderFromConn(driverConn.(driver.Conn), "", "logs")
		if err != nil {
			return err
		}
		defer func() { _ = appender.Close() }()

		for _, l := range batch.Logs {
			if err := appender.AppendRow(
				duckdb.UUID(l.ID),
				l.TS,
				l.ObservedTS,
				l.TraceID,
				l.SpanID,
				l.SeverityNumber,
				l.SeverityText,
				l.Body,
				l.Attributes,
				l.ResourceHash,
				now,
			); err != nil {
				return err
			}
		}
		return appender.Flush()
	})
	endStorageSpan(appendSpan, err)
	if err != nil {
		slog.Error("storage: append logs failed", "error", err)
		return
	}
	written = int64(len(batch.Logs))
	s.dispatchCommit(ctx, CommitEvent{Kind: KindLogs, Logs: LogBatch{Resources: batch.Resources, Logs: batch.Logs}})
}

func signalKindName(kind SignalKind) string {
	switch kind {
	case KindTraces:
		return "traces"
	case KindMetrics:
		return "metrics"
	case KindLogs:
		return "logs"
	default:
		return "unknown"
	}
}

func writerMsgSignal(kind writerMsgKind) string {
	switch kind {
	case msgTraces:
		return "traces"
	case msgMetrics:
		return "metrics"
	case msgLogs:
		return "logs"
	case msgSync:
		return "sync"
	case msgSweep:
		return "sweep"
	case msgClear:
		return "clear"
	default:
		return "unknown"
	}
}

// upsertResources inserts resource dimension rows not already known to
// resourceCache. Resources never change after first insert (the hash is
// over their whole attribute set), so a cache hit safely skips the round
// trip entirely — unlike metric_series, nothing here ever needs refreshing.
func (s *Storage) upsertResources(ctx context.Context, rows []ResourceRow) (err error) {
	ctx, span := startStorageSpan(ctx, "storage.upsertResources", attribute.Int("db.rows", len(rows)))
	defer func() { endStorageSpan(span, err) }()
	for _, r := range rows {
		if s.resourceCache.Contains(r.ResourceHash) {
			continue
		}
		attrs, err := json.Marshal(r.Attributes)
		if err != nil {
			return fmt.Errorf("storage: marshal resource attributes: %w", err)
		}
		attrsRaw, err := encodedAttributesOrFallback(r.AttributesRaw, r.Attributes)
		if err != nil {
			return fmt.Errorf("storage: encode resource attributes: %w", err)
		}
		_, err = s.writer.ExecContext(ctx,
			`INSERT INTO resources
			 (resource_hash, service_name, schema_url, dropped_attributes_count, attributes, attributes_raw)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT (resource_hash) DO NOTHING`,
			duckdb.Typed(r.ResourceHash, duckdb.TYPE_UBIGINT), r.ServiceName, r.SchemaURL, r.DroppedAttributesCount, attrs, attrsRaw,
		)
		if err != nil {
			return err
		}
		s.resourceCache.Add(r.ResourceHash)
	}
	return nil
}

// upsertSeries inserts or refreshes metric_series rows. ConvertMetrics has
// already deduplicated the input by series key. Stage the whole batch through
// the Appender and merge it with one statement: issuing one prepared
// INSERT ... ON CONFLICT per series dominates ingest once an exporter sends
// hundreds or thousands of series in one payload.
func (s *Storage) upsertSeries(ctx context.Context, rows []MetricSeriesRow) (err error) {
	ctx, span := startStorageSpan(ctx, "storage.upsertSeries", attribute.Int("db.rows", len(rows)))
	defer func() { endStorageSpan(span, err) }()
	if len(rows) == 0 {
		return nil
	}
	now := time.Now()
	if _, err := s.writer.ExecContext(ctx, `DELETE FROM metric_series_staging`); err != nil {
		return fmt.Errorf("storage: clear metric series staging table: %w", err)
	}
	err = s.writer.Raw(func(driverConn any) error {
		appender, appendErr := duckdb.NewAppenderWithColumns(driverConn.(driver.Conn), "", "", "metric_series_staging", []string{
			"series_key", "service_name", "metric_name", "metric_type", "number_kind", "unit", "description",
			"temporality", "is_monotonic", "attributes", "attributes_raw", "scope_name", "scope_version",
			"scope_schema_url", "scope_dropped_attributes_count", "scope_attributes", "scope_attributes_raw",
			"resource_hash", "first_seen", "last_seen",
		})
		if appendErr != nil {
			return appendErr
		}
		defer func() { _ = appender.Close() }()
		for _, r := range rows {
			attrsRaw, encodeErr := encodedAttributesOrFallback(r.AttributesRaw, r.Attributes)
			if encodeErr != nil {
				return fmt.Errorf("storage: encode series attributes: %w", encodeErr)
			}
			scopeAttrsRaw, encodeErr := encodedAttributesOrFallback(r.ScopeAttributesRaw, r.ScopeAttributes)
			if encodeErr != nil {
				return fmt.Errorf("storage: encode scope attributes: %w", encodeErr)
			}
			if appendErr := appender.AppendRow(
				r.SeriesKey, r.ServiceName, r.MetricName, r.MetricType,
				r.NumberKind, r.Unit, r.Description, r.Temporality, r.IsMonotonic, r.Attributes, attrsRaw,
				r.ScopeName, r.ScopeVersion, r.ScopeSchemaURL, r.ScopeDroppedAttributesCount,
				r.ScopeAttributes, scopeAttrsRaw, r.ResourceHash, now, now,
			); appendErr != nil {
				return appendErr
			}
		}
		return appender.Flush()
	})
	if err != nil {
		return fmt.Errorf("storage: stage metric series: %w", err)
	}
	_, err = s.writer.ExecContext(ctx, `
		MERGE INTO metric_series AS target
		USING metric_series_staging AS incoming
		ON target.series_key = incoming.series_key
		WHEN MATCHED THEN UPDATE SET
			description = incoming.description,
			last_seen = incoming.last_seen
		WHEN NOT MATCHED THEN INSERT (
			series_key, service_name, metric_name, metric_type, number_kind, unit, description,
			temporality, is_monotonic, attributes, attributes_raw, scope_name, scope_version,
			scope_schema_url, scope_dropped_attributes_count, scope_attributes, scope_attributes_raw,
			resource_hash, first_seen, last_seen
		) VALUES (
			incoming.series_key, incoming.service_name, incoming.metric_name, incoming.metric_type,
			incoming.number_kind, incoming.unit, incoming.description, incoming.temporality,
			incoming.is_monotonic, incoming.attributes, incoming.attributes_raw, incoming.scope_name,
			incoming.scope_version, incoming.scope_schema_url, incoming.scope_dropped_attributes_count,
			incoming.scope_attributes, incoming.scope_attributes_raw, incoming.resource_hash,
			incoming.first_seen, incoming.last_seen
		)
	`)
	if err != nil {
		return fmt.Errorf("storage: merge metric series: %w", err)
	}
	return nil
}

// performSweep runs one retention+max_size pass: delete expired fact rows,
// prune orphaned dimension rows, checkpoint, then (file-backed databases
// only) trim the oldest data repeatedly until under MaxSize.
func (s *Storage) performSweep(ctx context.Context) (err error) {
	ctx, span := startStorageSpan(ctx, "storage.performSweep")
	defer func() { endStorageSpan(span, err) }()
	cutoff := time.Now().Add(-s.opts.Retention)

	if err := s.deleteFactsBefore(ctx, cutoff); err != nil {
		return err
	}
	if err := s.pruneDimensions(ctx); err != nil {
		return err
	}
	if _, err := s.writer.ExecContext(ctx, `CHECKPOINT`); err != nil {
		return fmt.Errorf("storage: checkpoint: %w", err)
	}

	if s.opts.Path == "" {
		return nil // in-memory database: no file to size-cap
	}
	return s.enforceMaxSize(ctx)
}

func (s *Storage) deleteFactsBefore(ctx context.Context, cutoff time.Time) (err error) {
	ctx, span := startStorageSpan(ctx, "storage.deleteFactsBefore")
	defer func() { endStorageSpan(span, err) }()
	if _, err := s.writer.ExecContext(ctx, `BEGIN TRANSACTION`); err != nil {
		return fmt.Errorf("storage: begin fact deletion: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = s.writer.ExecContext(context.Background(), `ROLLBACK`)
		}
	}()
	if _, err := s.writer.ExecContext(ctx, `
		CREATE OR REPLACE TEMP TABLE affected_traces AS
		SELECT DISTINCT trace_id FROM spans WHERE start_ts < ?
	`, cutoff); err != nil {
		return fmt.Errorf("storage: collect traces affected by sweep: %w", err)
	}
	if _, err := s.writer.ExecContext(ctx, `DELETE FROM spans WHERE start_ts < ?`, cutoff); err != nil {
		return fmt.Errorf("storage: sweep spans: %w", err)
	}
	if err := s.rebuildAffectedTraceSummaries(ctx); err != nil {
		return err
	}
	if _, err := s.writer.ExecContext(ctx, `
		DELETE FROM metric_exemplars
		WHERE point_id IN (SELECT id FROM metric_points WHERE ts < ?)
	`, cutoff); err != nil {
		return fmt.Errorf("storage: sweep metric_exemplars: %w", err)
	}
	if _, err := s.writer.ExecContext(ctx, `DELETE FROM metric_points WHERE ts < ?`, cutoff); err != nil {
		return fmt.Errorf("storage: sweep metric_points: %w", err)
	}
	if _, err := s.writer.ExecContext(ctx, `DELETE FROM logs WHERE ts < ?`, cutoff); err != nil {
		return fmt.Errorf("storage: sweep logs: %w", err)
	}
	if _, err := s.writer.ExecContext(ctx, `DELETE FROM dropped_traces WHERE last_seen < ?`, cutoff); err != nil {
		return fmt.Errorf("storage: sweep dropped traces: %w", err)
	}
	if _, err := s.writer.ExecContext(ctx, `COMMIT`); err != nil {
		return fmt.Errorf("storage: commit fact deletion: %w", err)
	}
	committed = true
	return nil
}

// pruneDimensions deletes resources/metric_series rows no longer referenced
// by any fact row, then resets resourceCache. The reset is required for
// correctness, not just hygiene: resourceCache gates whether upsertResources
// re-inserts a resource row, so a stale "known" entry for a hash pruning
// just deleted would leave future spans/logs/series referencing a
// resource_hash with no matching dimension row.
//
// metric_series prunes first: a series orphaned this pass must release its
// resource reference before the resources prune decides what is still live —
// otherwise the resource lingers until the next sweep.
func (s *Storage) pruneDimensions(ctx context.Context) (err error) {
	ctx, span := startStorageSpan(ctx, "storage.pruneDimensions")
	defer func() { endStorageSpan(span, err) }()
	_, err = s.writer.ExecContext(ctx, `
		DELETE FROM metric_series
		WHERE series_key NOT IN (SELECT series_key FROM metric_points)
	`)
	if err != nil {
		return fmt.Errorf("storage: prune metric_series: %w", err)
	}
	_, err = s.writer.ExecContext(ctx, `
		DELETE FROM histogram_layouts
		WHERE layout_hash NOT IN (
			SELECT histogram_layout_hash FROM metric_points
			WHERE histogram_layout_hash IS NOT NULL
		)
	`)
	if err != nil {
		return fmt.Errorf("storage: prune histogram_layouts: %w", err)
	}

	_, err = s.writer.ExecContext(ctx, `
		DELETE FROM resources
		WHERE resource_hash NOT IN (SELECT resource_hash FROM spans)
		  AND resource_hash NOT IN (SELECT resource_hash FROM logs)
		  AND resource_hash NOT IN (SELECT resource_hash FROM metric_series)
	`)
	if err != nil {
		return fmt.Errorf("storage: prune resources: %w", err)
	}

	s.resourceCache = newLRUSet[uint64](resourceCacheCap)
	return nil
}

// enforceMaxSize repeatedly deletes the oldest remaining day of fact rows
// until the database file is under MaxSize or the iteration cap is hit.
//
// Note: DuckDB deleting rows and checkpointing does not necessarily shrink
// the file promptly — per docs/design/duckdb-storage.md, "old row groups
// delete wholesale and their space is reused in-file", i.e. reclaimed for
// future writes rather than returned to the OS. So this loop may run to
// maxSizeSweepIterations without ever observing size drop under MaxSize;
// that's an expected, logged outcome (see the warning below), not a bug.
func (s *Storage) enforceMaxSize(ctx context.Context) (err error) {
	ctx, span := startStorageSpan(ctx, "storage.enforceMaxSize")
	defer func() { endStorageSpan(span, err) }()
	for i := 0; i < maxSizeSweepIterations; i++ {
		size, err := s.sizeFn()
		if err != nil {
			return fmt.Errorf("storage: stat database file: %w", err)
		}
		if size <= s.opts.MaxSize {
			return nil
		}

		oldest, ok, err := s.oldestFactTimestamp(ctx)
		if err != nil {
			return err
		}
		if !ok {
			return nil // no fact rows left; nothing more to trim
		}

		dayCutoff := oldest.Add(24 * time.Hour)
		if err := s.deleteFactsBefore(ctx, dayCutoff); err != nil {
			return err
		}
		if err := s.pruneDimensions(ctx); err != nil {
			return err
		}
		if _, err := s.writer.ExecContext(ctx, `CHECKPOINT`); err != nil {
			return fmt.Errorf("storage: checkpoint: %w", err)
		}
	}

	slog.Warn("storage: max_size sweep hit its iteration limit without reaching the ceiling",
		"max_size", s.opts.MaxSize, "path", s.opts.Path)
	return nil
}

// performClear deletes every row from every table and checkpoints, then
// resets the in-writer resource cache so a full wipe cannot suppress a
// resource row that needs to be inserted again.
func (s *Storage) performClear(ctx context.Context) (err error) {
	ctx, span := startStorageSpan(ctx, "storage.performClear")
	defer func() { endStorageSpan(span, err) }()
	for _, table := range []string{"spans", "trace_summaries", "metric_exemplars", "metric_points", "logs", "metric_series", "histogram_layouts", "resources", "dropped_traces"} {
		if _, err := s.writer.ExecContext(ctx, `DELETE FROM `+table); err != nil { //nolint:gosec // table is a fixed internal identifier, never user input
			return fmt.Errorf("storage: clear %s: %w", table, err)
		}
	}
	if _, err := s.writer.ExecContext(ctx, `CHECKPOINT`); err != nil {
		return fmt.Errorf("storage: checkpoint: %w", err)
	}
	s.resourceCache = newLRUSet[uint64](resourceCacheCap)
	return nil
}

func (s *Storage) fileSize() (int64, error) {
	info, err := os.Stat(s.opts.Path)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

// oldestFactTimestamp returns the earliest timestamp across all fact
// tables, or ok=false if every fact table is empty.
func (s *Storage) oldestFactTimestamp(ctx context.Context) (time.Time, bool, error) {
	row := s.writer.QueryRowContext(ctx, `
		SELECT min(t) FROM (
			SELECT min(start_ts) AS t FROM spans
			UNION ALL SELECT min(ts) FROM metric_points
			UNION ALL SELECT min(ts) FROM logs
		)
	`)
	var t sql.NullTime
	if err := row.Scan(&t); err != nil {
		return time.Time{}, false, fmt.Errorf("storage: oldest fact timestamp: %w", err)
	}
	if !t.Valid {
		return time.Time{}, false, nil
	}
	return t.Time, true, nil
}

// spanEventsArg returns nil (a true SQL NULL through the Appender) for an
// empty event list rather than a typed-nil slice, which the Appender would
// instead JSON-encode as the literal "null".
func spanEventsArg(events []SpanEventRow) any {
	if len(events) == 0 {
		return nil
	}
	return events
}

// floatArg and timeArg convert the pointer-shaped "optional" fields
// convert.go produces into the bare-nil-or-value shape the Appender expects
// for a NULL column. The Appender's nullness check for numeric/timestamp
// columns is `val == nil` on the untyped any it receives — a typed nil
// pointer (*float64)(nil) does not satisfy that check and instead fails to
// cast, so these must dereference to the underlying type or return a plain
// untyped nil.
func floatArg(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func int64Arg(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

func uint64Arg(p *uint64) any {
	if p == nil {
		return nil
	}
	return *p
}

func int32Arg(p *int32) any {
	if p == nil {
		return nil
	}
	return *p
}

func timeArg(p *time.Time) any {
	if p == nil {
		return nil
	}
	return *p
}
