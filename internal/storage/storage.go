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
	"sync"
	"sync/atomic"
	"time"

	duckdb "github.com/duckdb/duckdb-go/v2"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
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

	// spanDedupCap bounds the in-writer LRU of recently-appended
	// (trace_id, span_id) pairs used to drop duplicate re-sends.
	spanDedupCap = 200_000

	// sweepInterval is how often the background retention/max_size sweep
	// runs, matching docs/design/duckdb-storage.md's "hourly sweep".
	sweepInterval = time.Hour

	// maxSizeSweepIterations bounds how many "delete the oldest day" passes
	// enforceMaxSize will attempt in one call. It's a hard stop so a
	// pathological max_size (smaller than DuckDB's fixed per-file overhead)
	// can't spin forever; the sweep just logs a warning and gives up for
	// this pass, trying again next hour.
	maxSizeSweepIterations = 60
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
	// OnCommit, if set, is invoked by the writer goroutine after each
	// batch's fact rows are durably flushed — see docs/design/duckdb-storage.md's
	// ingest step 4 ("after flush, invoke onAdd ... to feed the WebSocket
	// hub, mirroring the previous store's contract"). It runs synchronously
	// on the writer goroutine, so callers needing concurrency (e.g. slow
	// broadcast fan-out) should hand off rather than block here.
	OnCommit OnCommitFunc
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
	// Traces is populated (only the newly-appended, deduped spans) when Kind == KindTraces.
	Traces TraceBatch
	// Metrics is populated (series metadata for every series referenced by
	// Points, plus the newly-appended points) when Kind == KindMetrics.
	Metrics MetricBatch
	// Logs is populated (resources plus the newly-appended log rows) when Kind == KindLogs.
	Logs LogBatch
}

// OnCommitFunc is the type of Options.OnCommit.
type OnCommitFunc func(ctx context.Context, ev CommitEvent)

// spanKey identifies a span for dedup purposes.
type spanKey struct {
	traceID string
	spanID  string
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
	kind    writerMsgKind
	traces  TraceBatch
	metrics MetricBatch
	logs    LogBatch
	done    chan error
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

	// resourceCache and spanDedup are pure caches: a miss just means the
	// slow path runs (an INSERT ... ON CONFLICT DO NOTHING, or appending a
	// row a dedup read query would have collapsed anyway), so eviction can
	// never corrupt results — only cost an extra round trip or a rare
	// duplicate fact row.
	resourceCache *lruSet[uint64]
	spanDedup     *lruSet[spanKey]

	sweepTicker *time.Ticker
	sweepStop   chan struct{}

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
}

// Open creates or opens a DuckDB database at opts.Path (or an in-memory
// database if empty), applies schema migrations, and starts the writer and
// sweep goroutines.
func Open(ctx context.Context, opts Options) (*Storage, error) {
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

	s := &Storage{
		opts:          opts,
		connector:     connector,
		db:            db,
		writer:        writerConn,
		queue:         make(chan writerMsg, writeQueueSize),
		resourceCache: newLRUSet[uint64](resourceCacheCap),
		spanDedup:     newLRUSet[spanKey](spanDedupCap),
		sweepStop:     make(chan struct{}),
	}
	s.sizeFn = s.fileSize

	s.wg.Add(1)
	go s.run()

	s.sweepTicker = time.NewTicker(sweepInterval)
	s.wg.Add(1)
	go s.sweepLoop()

	return s, nil
}

// DB returns the general-purpose read connection pool. Phase 1 has no query
// layer of its own yet (that's Phase 2's read query layer); this is the seam
// tests use to verify ingested rows, and that a later phase's read API will
// wrap.
func (s *Storage) DB() *sql.DB { return s.db }

// AddTraces converts td and enqueues it for the writer. Converting outside
// the writer goroutine keeps pdata processing (which can run concurrently
// with other batches) off the single serialized write path.
func (s *Storage) AddTraces(ctx context.Context, td ptrace.Traces) {
	batch := ConvertTraces(td)
	if len(batch.Resources) == 0 && len(batch.Spans) == 0 {
		return
	}
	s.enqueue(writerMsg{kind: msgTraces, traces: batch}, "traces")
}

// AddMetrics converts md and enqueues it for the writer.
func (s *Storage) AddMetrics(ctx context.Context, md pmetric.Metrics) {
	batch := ConvertMetrics(md)
	if len(batch.Series) == 0 && len(batch.Points) == 0 {
		return
	}
	s.enqueue(writerMsg{kind: msgMetrics, metrics: batch}, "metrics")
}

// AddLogs converts ld and enqueues it for the writer.
func (s *Storage) AddLogs(ctx context.Context, ld plog.Logs) {
	batch := ConvertLogs(ld)
	if len(batch.Resources) == 0 && len(batch.Logs) == 0 {
		return
	}
	s.enqueue(writerMsg{kind: msgLogs, logs: batch}, "logs")
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
		slog.Warn("storage: write queue full, dropping batch", "signal", what)
	}
}

// enqueueBlocking submits a control message (Sync/Sweep) that must never be
// silently dropped — unlike AddX batches, callers are explicitly waiting on
// msg.done. It still respects the closed flag so a call racing Close is a
// safe no-op rather than a send on a soon-to-be-closed channel.
func (s *Storage) enqueueBlocking(msg writerMsg) bool {
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
	ctx := context.Background()
	for msg := range s.queue {
		switch msg.kind {
		case msgTraces:
			s.writeTraces(ctx, msg.traces)
		case msgMetrics:
			s.writeMetrics(ctx, msg.metrics)
		case msgLogs:
			s.writeLogs(ctx, msg.logs)
		case msgSync:
			msg.done <- nil
		case msgSweep:
			msg.done <- s.performSweep(ctx)
		case msgClear:
			msg.done <- s.performClear(ctx)
		}
	}
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

// writeTraces upserts the batch's resource rows, drops spans already seen
// via spanDedup, and appends the rest.
func (s *Storage) writeTraces(ctx context.Context, batch TraceBatch) {
	if err := s.upsertResources(ctx, batch.Resources); err != nil {
		slog.Error("storage: upsert resources failed", "error", err)
		return
	}

	kept := make([]SpanRow, 0, len(batch.Spans))
	for _, sp := range batch.Spans {
		key := spanKey{traceID: sp.TraceID, spanID: sp.SpanID}
		if s.spanDedup.Contains(key) {
			continue
		}
		s.spanDedup.Add(key)
		kept = append(kept, sp)
	}
	if len(kept) == 0 {
		return
	}

	now := time.Now()
	err := s.writer.Raw(func(driverConn any) error {
		appender, err := duckdb.NewAppenderFromConn(driverConn.(driver.Conn), "", "spans")
		if err != nil {
			return err
		}
		defer func() { _ = appender.Close() }()

		for _, sp := range kept {
			if err := appender.AppendRow(
				sp.TraceID,
				sp.SpanID,
				sp.ParentSpanID,
				sp.Name,
				sp.Kind,
				sp.StartTS,
				sp.EndTS,
				sp.StatusCode,
				sp.StatusMessage,
				sp.Attributes,
				spanEventsArg(sp.Events),
				sp.ResourceHash,
				now,
			); err != nil {
				return err
			}
		}
		return appender.Flush()
	})
	if err != nil {
		slog.Error("storage: append spans failed", "error", err)
		return
	}
	if s.opts.OnCommit != nil {
		s.opts.OnCommit(ctx, CommitEvent{Kind: KindTraces, Traces: TraceBatch{Spans: kept}})
	}
}

// writeMetrics upserts the batch's resource rows and series metadata, then
// appends every point.
func (s *Storage) writeMetrics(ctx context.Context, batch MetricBatch) {
	if err := s.upsertResources(ctx, batch.Resources); err != nil {
		slog.Error("storage: upsert resources failed", "error", err)
		return
	}
	if err := s.upsertSeries(ctx, batch.Series); err != nil {
		slog.Error("storage: upsert metric series failed", "error", err)
		return
	}
	if len(batch.Points) == 0 {
		return
	}

	err := s.writer.Raw(func(driverConn any) error {
		appender, err := duckdb.NewAppenderFromConn(driverConn.(driver.Conn), "", "metric_points")
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
				floatArg(p.Value),
				floatArg(p.Count),
				floatArg(p.Sum),
				floatArg(p.Min),
				floatArg(p.Max),
			); err != nil {
				return err
			}
		}
		return appender.Flush()
	})
	if err != nil {
		slog.Error("storage: append metric points failed", "error", err)
		return
	}
	if s.opts.OnCommit != nil {
		s.opts.OnCommit(ctx, CommitEvent{Kind: KindMetrics, Metrics: batch})
	}
}

// writeLogs upserts the batch's resource rows, then appends every log.
func (s *Storage) writeLogs(ctx context.Context, batch LogBatch) {
	if err := s.upsertResources(ctx, batch.Resources); err != nil {
		slog.Error("storage: upsert resources failed", "error", err)
		return
	}
	if len(batch.Logs) == 0 {
		return
	}

	now := time.Now()
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
	if err != nil {
		slog.Error("storage: append logs failed", "error", err)
		return
	}
	if s.opts.OnCommit != nil {
		s.opts.OnCommit(ctx, CommitEvent{Kind: KindLogs, Logs: LogBatch{Resources: batch.Resources, Logs: batch.Logs}})
	}
}

// upsertResources inserts resource dimension rows not already known to
// resourceCache. Resources never change after first insert (the hash is
// over their whole attribute set), so a cache hit safely skips the round
// trip entirely — unlike metric_series, nothing here ever needs refreshing.
func (s *Storage) upsertResources(ctx context.Context, rows []ResourceRow) error {
	for _, r := range rows {
		if s.resourceCache.Contains(r.ResourceHash) {
			continue
		}
		attrs, err := json.Marshal(r.Attributes)
		if err != nil {
			return fmt.Errorf("storage: marshal resource attributes: %w", err)
		}
		_, err = s.writer.ExecContext(ctx,
			`INSERT INTO resources (resource_hash, service_name, attributes) VALUES (?, ?, ?)
			 ON CONFLICT (resource_hash) DO NOTHING`,
			duckdb.Typed(r.ResourceHash, duckdb.TYPE_UBIGINT), r.ServiceName, attrs,
		)
		if err != nil {
			return err
		}
		s.resourceCache.Add(r.ResourceHash)
	}
	return nil
}

// upsertSeries inserts or refreshes metric_series rows. Every unique series
// in the batch always executes the upsert (no cache gating): last_seen must
// stay current for retention/staleness purposes, and ConvertMetrics already
// deduplicates a series repeated within one batch, so this is at most one
// statement per distinct series per AddMetrics call.
func (s *Storage) upsertSeries(ctx context.Context, rows []MetricSeriesRow) error {
	if len(rows) == 0 {
		return nil
	}
	now := time.Now()
	for _, r := range rows {
		attrs, err := json.Marshal(r.Attributes)
		if err != nil {
			return fmt.Errorf("storage: marshal series attributes: %w", err)
		}
		_, err = s.writer.ExecContext(ctx,
			`INSERT INTO metric_series
			   (series_key, service_name, metric_name, metric_type, unit, description, temporality, is_monotonic, attributes, resource_hash, first_seen, last_seen)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (series_key) DO UPDATE SET last_seen = excluded.last_seen`,
			duckdb.Typed(r.SeriesKey, duckdb.TYPE_UBIGINT), r.ServiceName, r.MetricName, r.MetricType,
			r.Unit, r.Description, r.Temporality, r.IsMonotonic, attrs,
			duckdb.Typed(r.ResourceHash, duckdb.TYPE_UBIGINT), now, now,
		)
		if err != nil {
			return err
		}
	}
	return nil
}

// performSweep runs one retention+max_size pass: delete expired fact rows,
// prune orphaned dimension rows, checkpoint, then (file-backed databases
// only) trim the oldest data repeatedly until under MaxSize.
func (s *Storage) performSweep(ctx context.Context) error {
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

func (s *Storage) deleteFactsBefore(ctx context.Context, cutoff time.Time) error {
	if _, err := s.writer.ExecContext(ctx, `DELETE FROM spans WHERE start_ts < ?`, cutoff); err != nil {
		return fmt.Errorf("storage: sweep spans: %w", err)
	}
	if _, err := s.writer.ExecContext(ctx, `DELETE FROM metric_points WHERE ts < ?`, cutoff); err != nil {
		return fmt.Errorf("storage: sweep metric_points: %w", err)
	}
	if _, err := s.writer.ExecContext(ctx, `DELETE FROM logs WHERE ts < ?`, cutoff); err != nil {
		return fmt.Errorf("storage: sweep logs: %w", err)
	}
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
func (s *Storage) pruneDimensions(ctx context.Context) error {
	_, err := s.writer.ExecContext(ctx, `
		DELETE FROM metric_series
		WHERE series_key NOT IN (SELECT series_key FROM metric_points)
	`)
	if err != nil {
		return fmt.Errorf("storage: prune metric_series: %w", err)
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
func (s *Storage) enforceMaxSize(ctx context.Context) error {
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
// resets the in-writer caches — a stale resourceCache/spanDedup entry after
// a full wipe would otherwise skip re-inserting a resource or re-appending a
// span that legitimately needs to exist again.
func (s *Storage) performClear(ctx context.Context) error {
	for _, table := range []string{"spans", "metric_points", "logs", "metric_series", "resources"} {
		if _, err := s.writer.ExecContext(ctx, `DELETE FROM `+table); err != nil { //nolint:gosec // table is a fixed internal identifier, never user input
			return fmt.Errorf("storage: clear %s: %w", table, err)
		}
	}
	if _, err := s.writer.ExecContext(ctx, `CHECKPOINT`); err != nil {
		return fmt.Errorf("storage: checkpoint: %w", err)
	}
	s.resourceCache = newLRUSet[uint64](resourceCacheCap)
	s.spanDedup = newLRUSet[spanKey](spanDedupCap)
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

func timeArg(p *time.Time) any {
	if p == nil {
		return nil
	}
	return *p
}
