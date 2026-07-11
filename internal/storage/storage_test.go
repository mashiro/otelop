package storage

import (
	"context"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

func openTestStorage(t *testing.T, opts Options) *Storage {
	t.Helper()
	s, err := Open(context.Background(), opts)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Errorf("Close: %v", err)
		}
	})
	return s
}

func buildTraces(traceID, spanID [16]byte, spanID8 [8]byte, name string, start time.Time) ptrace.Traces {
	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "svc")
	ss := rs.ScopeSpans().AppendEmpty()
	span := ss.Spans().AppendEmpty()
	span.SetTraceID(pcommon.TraceID(traceID))
	span.SetSpanID(pcommon.SpanID(spanID8))
	span.SetName(name)
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(start))
	span.SetEndTimestamp(pcommon.NewTimestampFromTime(start.Add(10 * time.Millisecond)))
	return td
}

func TestStorage_AddTraces_IngestIsQueryable(t *testing.T) {
	s := openTestStorage(t, Options{})
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	td := buildTraces([16]byte{1}, [16]byte{}, [8]byte{1}, "op-a", start)

	s.AddTraces(context.Background(), td)
	s.Sync()

	var name, traceID string
	err := s.DB().QueryRowContext(context.Background(),
		`SELECT trace_id, name FROM spans WHERE span_id = ?`, "0100000000000000").
		Scan(&traceID, &name)
	if err != nil {
		t.Fatalf("query span: %v", err)
	}
	if name != "op-a" {
		t.Errorf("name = %q, want op-a", name)
	}

	var resourceCount int
	if err := s.DB().QueryRowContext(context.Background(), `SELECT count(*) FROM resources`).Scan(&resourceCount); err != nil {
		t.Fatalf("count resources: %v", err)
	}
	if resourceCount != 1 {
		t.Errorf("resources count = %d, want 1", resourceCount)
	}
}

func TestStorage_AddTraces_DuplicateSpanIsDeduped(t *testing.T) {
	s := openTestStorage(t, Options{})
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	td := buildTraces([16]byte{2}, [16]byte{}, [8]byte{2}, "op-b", start)

	// Simulate an OTLP re-send: the exact same span arrives twice.
	s.AddTraces(context.Background(), td)
	s.AddTraces(context.Background(), td)
	s.Sync()

	var count int
	err := s.DB().QueryRowContext(context.Background(),
		`SELECT count(*) FROM spans WHERE span_id = ?`, "0200000000000000").Scan(&count)
	if err != nil {
		t.Fatalf("count spans: %v", err)
	}
	if count != 1 {
		t.Errorf("span count = %d, want 1 (duplicate should be deduped)", count)
	}
}

func TestStorage_AddMetrics_IngestIsQueryable(t *testing.T) {
	s := openTestStorage(t, Options{})
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")
	sm := rm.ScopeMetrics().AppendEmpty()
	sm.SetSchemaUrl("https://opentelemetry.io/schemas/1.30.0")
	sm.Scope().SetName("example.metrics")
	sm.Scope().SetVersion("1.2.3")
	sm.Scope().Attributes().PutStr("library.language", "go")
	m := sm.Metrics().AppendEmpty()
	m.SetName("cpu.usage")
	dp := m.SetEmptyGauge().DataPoints().AppendEmpty()
	dp.SetDoubleValue(0.75)
	dp.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))

	s.AddMetrics(context.Background(), md)
	s.Sync()

	var value float64
	err := s.DB().QueryRowContext(context.Background(), `
		SELECT p.value FROM metric_points p
		JOIN metric_series s ON s.series_key = p.series_key
		WHERE s.metric_name = ?
	`, "cpu.usage").Scan(&value)
	if err != nil {
		t.Fatalf("query metric point: %v", err)
	}
	if value != 0.75 {
		t.Errorf("value = %v, want 0.75", value)
	}

	var scopeName, scopeVersion, scopeSchemaURL, scopeLanguage string
	err = s.DB().QueryRowContext(context.Background(), `
		SELECT scope_name, scope_version, scope_schema_url,
		       scope_attributes->>'library.language'
		FROM metric_series WHERE metric_name = ?
	`, "cpu.usage").Scan(&scopeName, &scopeVersion, &scopeSchemaURL, &scopeLanguage)
	if err != nil {
		t.Fatalf("query metric scope: %v", err)
	}
	if scopeName != "example.metrics" || scopeVersion != "1.2.3" ||
		scopeSchemaURL != "https://opentelemetry.io/schemas/1.30.0" || scopeLanguage != "go" {
		t.Errorf("scope = %q/%q/%q/%q", scopeName, scopeVersion, scopeSchemaURL, scopeLanguage)
	}
}

func TestStorage_AddMetrics_SeriesMetadataRefreshesLastSeen(t *testing.T) {
	s := openTestStorage(t, Options{})
	newMetric := func(v float64, ts time.Time) pmetric.Metrics {
		md := pmetric.NewMetrics()
		rm := md.ResourceMetrics().AppendEmpty()
		sm := rm.ScopeMetrics().AppendEmpty()
		m := sm.Metrics().AppendEmpty()
		m.SetName("requests")
		dp := m.SetEmptyGauge().DataPoints().AppendEmpty()
		dp.SetDoubleValue(v)
		dp.SetTimestamp(pcommon.NewTimestampFromTime(ts))
		return md
	}

	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	s.AddMetrics(context.Background(), newMetric(1, t0))
	s.Sync()

	var firstSeen1, lastSeen1 time.Time
	err := s.DB().QueryRowContext(context.Background(),
		`SELECT first_seen, last_seen FROM metric_series WHERE metric_name = 'requests'`).
		Scan(&firstSeen1, &lastSeen1)
	if err != nil {
		t.Fatalf("query series (1st): %v", err)
	}

	t1 := t0.Add(time.Second)
	s.AddMetrics(context.Background(), newMetric(2, t1))
	s.Sync()

	var firstSeen2, lastSeen2 time.Time
	var seriesCount int
	err = s.DB().QueryRowContext(context.Background(),
		`SELECT first_seen, last_seen FROM metric_series WHERE metric_name = 'requests'`).
		Scan(&firstSeen2, &lastSeen2)
	if err != nil {
		t.Fatalf("query series (2nd): %v", err)
	}
	if err := s.DB().QueryRowContext(context.Background(),
		`SELECT count(*) FROM metric_series WHERE metric_name = 'requests'`).Scan(&seriesCount); err != nil {
		t.Fatalf("count series: %v", err)
	}

	if seriesCount != 1 {
		t.Fatalf("expected exactly 1 metric_series row across two batches, got %d", seriesCount)
	}
	if !firstSeen1.Equal(firstSeen2) {
		t.Errorf("first_seen changed across batches: %v -> %v", firstSeen1, firstSeen2)
	}
	if !lastSeen2.After(lastSeen1) {
		t.Errorf("last_seen did not advance: %v -> %v", lastSeen1, lastSeen2)
	}
}

func TestStorage_AddLogs_IngestIsQueryable(t *testing.T) {
	s := openTestStorage(t, Options{})
	ld := plog.NewLogs()
	rl := ld.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("service.name", "svc")
	sl := rl.ScopeLogs().AppendEmpty()
	lr := sl.LogRecords().AppendEmpty()
	lr.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	lr.Body().SetStr("hello")
	lr.SetTraceID(pcommon.TraceID([16]byte{9}))

	s.AddLogs(context.Background(), ld)
	s.Sync()

	var body string
	err := s.DB().QueryRowContext(context.Background(), `SELECT body FROM logs WHERE trace_id = ?`,
		pcommon.TraceID([16]byte{9}).String()).Scan(&body)
	if err != nil {
		t.Fatalf("query log: %v", err)
	}
	if body != "hello" {
		t.Errorf("body = %q, want hello", body)
	}
}

// TestStorage_TimestampNanosecondFidelity is the fidelity check the task
// requires: a timestamp with non-zero sub-microsecond nanoseconds must
// round-trip exactly through the Appender (spans.start_ts) and back out
// through a normal query.
func TestStorage_TimestampNanosecondFidelity(t *testing.T) {
	s := openTestStorage(t, Options{})
	start := time.Date(2026, 7, 11, 12, 0, 0, 123456789, time.UTC)
	td := buildTraces([16]byte{3}, [16]byte{}, [8]byte{3}, "ns-span", start)

	s.AddTraces(context.Background(), td)
	s.Sync()

	var got time.Time
	err := s.DB().QueryRowContext(context.Background(),
		`SELECT start_ts FROM spans WHERE span_id = ?`, "0300000000000000").Scan(&got)
	if err != nil {
		t.Fatalf("query start_ts: %v", err)
	}
	if got.Nanosecond() != 123456789 {
		t.Errorf("start_ts nanosecond = %d, want 123456789 (TIMESTAMP_NS should preserve full precision)", got.Nanosecond())
	}
	if !got.Equal(start) {
		t.Errorf("start_ts = %v, want %v", got, start)
	}
}

func TestStorage_Sync_WaitsForEnqueuedWork(t *testing.T) {
	s := openTestStorage(t, Options{})
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 20; i++ {
		td := buildTraces([16]byte{4}, [16]byte{}, [8]byte{byte(i)}, "op", start)
		s.AddTraces(context.Background(), td)
	}
	s.Sync()

	var count int
	if err := s.DB().QueryRowContext(context.Background(), `SELECT count(*) FROM spans`).Scan(&count); err != nil {
		t.Fatalf("count spans: %v", err)
	}
	if count != 20 {
		t.Errorf("spans count = %d, want 20 (Sync should block until all enqueued batches are written)", count)
	}
}

func TestStorage_Close_DrainsPendingWrites(t *testing.T) {
	// File-backed: Close tears down every connection (including the general
	// pool DB() returns), so verifying "the write actually landed" requires
	// reopening the database file afterwards rather than reusing a handle
	// into a database that no longer exists (as an in-memory one would).
	dir := t.TempDir()
	path := filepath.Join(dir, "otelop.duckdb")

	s, err := Open(context.Background(), Options{Path: path})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 5; i++ {
		td := buildTraces([16]byte{5}, [16]byte{}, [8]byte{byte(i)}, "op", start)
		s.AddTraces(context.Background(), td)
	}

	// No Sync before Close: Close itself must drain whatever was already
	// enqueued rather than discarding it.
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	// A second Close must be a safe no-op.
	if err := s.Close(); err != nil {
		t.Errorf("second Close returned an error: %v", err)
	}

	// AddTraces after Close must not panic (send on closed channel) and
	// must not write anything.
	s.AddTraces(context.Background(), buildTraces([16]byte{6}, [16]byte{}, [8]byte{9}, "op", start))

	reopened := openTestStorage(t, Options{Path: path})
	var count int
	if err := reopened.DB().QueryRowContext(context.Background(), `SELECT count(*) FROM spans`).Scan(&count); err != nil {
		t.Fatalf("count spans after close: %v", err)
	}
	if count != 5 {
		t.Errorf("spans count after Close = %d, want 5 (Close must drain pending writes)", count)
	}
}

func TestStorage_Sweep_DeletesExpiredFactsKeepsRecent(t *testing.T) {
	s := openTestStorage(t, Options{Retention: time.Hour})
	now := time.Now()

	old := buildTraces([16]byte{7}, [16]byte{}, [8]byte{1}, "old-span", now.Add(-2*time.Hour))
	recent := buildTraces([16]byte{7}, [16]byte{}, [8]byte{2}, "recent-span", now)
	s.AddTraces(context.Background(), old)
	s.AddTraces(context.Background(), recent)
	s.Sync()

	if err := s.Sweep(context.Background()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}

	var names []string
	rows, err := s.DB().QueryContext(context.Background(), `SELECT name FROM spans ORDER BY name`)
	if err != nil {
		t.Fatalf("query spans: %v", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan: %v", err)
		}
		names = append(names, name)
	}

	if len(names) != 1 || names[0] != "recent-span" {
		t.Errorf("spans after sweep = %v, want only [recent-span]", names)
	}
}

func TestStorage_Sweep_PrunesOrphanedDimensionRows(t *testing.T) {
	s := openTestStorage(t, Options{Retention: time.Hour})
	now := time.Now()

	// Resource A only ever appears on an old span; resource B appears on a
	// recent one. After sweep, only resource B's dimension row should
	// remain.
	tdOld := ptrace.NewTraces()
	rsOld := tdOld.ResourceSpans().AppendEmpty()
	rsOld.Resource().Attributes().PutStr("service.name", "svc-old-only")
	spanOld := rsOld.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	spanOld.SetTraceID(pcommon.TraceID([16]byte{8}))
	spanOld.SetSpanID(pcommon.SpanID([8]byte{1}))
	spanOld.SetStartTimestamp(pcommon.NewTimestampFromTime(now.Add(-2 * time.Hour)))
	spanOld.SetEndTimestamp(pcommon.NewTimestampFromTime(now.Add(-2 * time.Hour)))

	tdRecent := ptrace.NewTraces()
	rsRecent := tdRecent.ResourceSpans().AppendEmpty()
	rsRecent.Resource().Attributes().PutStr("service.name", "svc-recent")
	spanRecent := rsRecent.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	spanRecent.SetTraceID(pcommon.TraceID([16]byte{8}))
	spanRecent.SetSpanID(pcommon.SpanID([8]byte{2}))
	spanRecent.SetStartTimestamp(pcommon.NewTimestampFromTime(now))
	spanRecent.SetEndTimestamp(pcommon.NewTimestampFromTime(now))

	s.AddTraces(context.Background(), tdOld)
	s.AddTraces(context.Background(), tdRecent)
	s.Sync()

	var beforeCount int
	if err := s.DB().QueryRowContext(context.Background(), `SELECT count(*) FROM resources`).Scan(&beforeCount); err != nil {
		t.Fatalf("count resources before sweep: %v", err)
	}
	if beforeCount != 2 {
		t.Fatalf("expected 2 resource rows before sweep, got %d", beforeCount)
	}

	if err := s.Sweep(context.Background()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}

	var names []string
	rows, err := s.DB().QueryContext(context.Background(), `SELECT service_name FROM resources ORDER BY service_name`)
	if err != nil {
		t.Fatalf("query resources: %v", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan: %v", err)
		}
		names = append(names, name)
	}
	if len(names) != 1 || names[0] != "svc-recent" {
		t.Errorf("resources after sweep = %v, want only [svc-recent]", names)
	}
}

// TestStorage_Sweep_KeepsResourcesReferencedOnlyByMetricSeries is the
// regression test for the metric_series resource_hash addition: the
// resources prune must count metric_series references as live, otherwise a
// sweep deletes resource rows that current metric series still point at,
// dangling every metric's resource join.
func TestStorage_Sweep_KeepsResourcesReferencedOnlyByMetricSeries(t *testing.T) {
	s := openTestStorage(t, Options{Retention: time.Hour})
	now := time.Now()

	// Resource "svc-metric-only" is referenced solely by a (recent) metric
	// series — no span or log ever carries it.
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc-metric-only")
	m := rm.ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
	m.SetName("cpu")
	dp := m.SetEmptyGauge().DataPoints().AppendEmpty()
	dp.SetDoubleValue(1)
	dp.SetTimestamp(pcommon.NewTimestampFromTime(now))
	s.AddMetrics(context.Background(), md)

	// Resource "svc-span-only" is referenced solely by an expired span, so
	// the sweep must prune it — proving the prune still fires while the
	// metric-only resource survives.
	tdOld := ptrace.NewTraces()
	rsOld := tdOld.ResourceSpans().AppendEmpty()
	rsOld.Resource().Attributes().PutStr("service.name", "svc-span-only")
	spanOld := rsOld.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	spanOld.SetTraceID(pcommon.TraceID([16]byte{40}))
	spanOld.SetSpanID(pcommon.SpanID([8]byte{40}))
	spanOld.SetStartTimestamp(pcommon.NewTimestampFromTime(now.Add(-2 * time.Hour)))
	spanOld.SetEndTimestamp(pcommon.NewTimestampFromTime(now.Add(-2 * time.Hour)))
	s.AddTraces(context.Background(), tdOld)
	s.Sync()

	if err := s.Sweep(context.Background()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}

	var names []string
	rows, err := s.DB().QueryContext(context.Background(), `SELECT service_name FROM resources ORDER BY service_name`)
	if err != nil {
		t.Fatalf("query resources: %v", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan: %v", err)
		}
		names = append(names, name)
	}
	if len(names) != 1 || names[0] != "svc-metric-only" {
		t.Errorf("resources after sweep = %v, want only [svc-metric-only]", names)
	}
}

// TestStorage_Sweep_MaxSizeTrimsOldestDaysUntilUnderCeiling drives
// enforceMaxSize's "delete the oldest day repeatedly until under MaxSize"
// loop with a fake sizeFn rather than real file bytes. DuckDB deleting rows
// and checkpointing does not reliably shrink the file promptly (see the
// comment on enforceMaxSize) — space is reused in-file, not returned to the
// OS — so asserting on real os.Stat sizes here would be flaky by
// construction. The fake simulates a file that shrinks by a fixed amount per
// deleted day, which is enough to test the loop's control flow (deletes
// oldest-first, stops once under the ceiling) while the actual row deletion
// still runs for real against the database.
func TestStorage_Sweep_MaxSizeTrimsOldestDaysUntilUnderCeiling(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "otelop.duckdb")
	s := openTestStorage(t, Options{Path: path, Retention: 365 * 24 * time.Hour})

	now := time.Now()
	const days = 5
	for day := 0; day < days; day++ {
		ts := now.Add(-time.Duration(days-1-day) * 24 * time.Hour)
		td := buildTraces([16]byte{10}, [16]byte{}, [8]byte{byte(day)}, "day-span", ts)
		s.AddTraces(context.Background(), td)
	}
	s.Sync()

	const perDayBytes = int64(100)
	calls := 0
	s.sizeFn = func() (int64, error) {
		size := int64(days)*perDayBytes - int64(calls)*perDayBytes
		calls++
		return size, nil
	}
	// Sized to converge after exactly 3 deletions (500 -> 400 -> 300 -> 200 <= 200).
	s.opts.MaxSize = 2 * perDayBytes

	if err := s.Sweep(context.Background()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}

	var remaining int
	if err := s.DB().QueryRowContext(context.Background(), `SELECT count(*) FROM spans`).Scan(&remaining); err != nil {
		t.Fatalf("count spans: %v", err)
	}
	if remaining != 2 {
		t.Fatalf("spans remaining = %d, want 2 (the fake sizeFn should force exactly 3 of 5 days to be deleted)", remaining)
	}

	// The two most recent days (day3, day4) must be the ones that survived.
	var oldestRemaining time.Time
	if err := s.DB().QueryRowContext(context.Background(), `SELECT min(start_ts) FROM spans`).Scan(&oldestRemaining); err != nil {
		t.Fatalf("min(start_ts): %v", err)
	}
	day3Ts := now.Add(-1 * 24 * time.Hour)
	if oldestRemaining.Before(day3Ts.Add(-time.Minute)) {
		t.Errorf("oldest remaining span start_ts = %v, want >= day3 (%v) — expected the 3 oldest days to be deleted first", oldestRemaining, day3Ts)
	}
}

func TestStorage_Sweep_SkipsMaxSizeForInMemoryDB(t *testing.T) {
	s := openTestStorage(t, Options{Path: "", MaxSize: 1}) // absurdly small ceiling
	td := buildTraces([16]byte{11}, [16]byte{}, [8]byte{1}, "op", time.Now())
	s.AddTraces(context.Background(), td)
	s.Sync()

	// Must not attempt os.Stat("") or otherwise fail for an in-memory DB.
	if err := s.Sweep(context.Background()); err != nil {
		t.Fatalf("Sweep on in-memory db with tiny MaxSize: %v", err)
	}

	var count int
	if err := s.DB().QueryRowContext(context.Background(), `SELECT count(*) FROM spans`).Scan(&count); err != nil {
		t.Fatalf("count spans: %v", err)
	}
	if count != 1 {
		t.Errorf("in-memory sweep should not have trimmed anything, spans = %d, want 1", count)
	}
}

func TestStorage_Open_DefaultsRetentionAndMaxSize(t *testing.T) {
	s, err := Open(context.Background(), Options{})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = s.Close() }()

	if s.opts.Retention != defaultRetention {
		t.Errorf("Retention = %v, want default %v", s.opts.Retention, defaultRetention)
	}
	if s.opts.MaxSize != defaultMaxSize {
		t.Errorf("MaxSize = %d, want default %d", s.opts.MaxSize, defaultMaxSize)
	}
}

func TestStorage_Open_FileBacked(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "otelop.duckdb")
	s := openTestStorage(t, Options{Path: path})

	td := buildTraces([16]byte{12}, [16]byte{}, [8]byte{1}, "op", time.Now())
	s.AddTraces(context.Background(), td)
	s.Sync()

	var count int
	if err := s.DB().QueryRowContext(context.Background(), `SELECT count(*) FROM spans`).Scan(&count); err != nil {
		t.Fatalf("count spans: %v", err)
	}
	if count != 1 {
		t.Fatalf("spans count = %d, want 1", count)
	}
}

// TestStorage_OnCommit_FiresPerSignalAfterFlush verifies the OnCommit hook —
// the seam internal/broadcast attaches to — fires exactly once per AddX call
// (batching all rows written in that call), after the rows are already
// durably queryable, and never before.
func TestStorage_OnCommit_FiresPerSignalAfterFlush(t *testing.T) {
	var mu sync.Mutex
	var events []CommitEvent
	s, err := Open(context.Background(), Options{OnCommit: func(_ context.Context, ev CommitEvent) {
		mu.Lock()
		defer mu.Unlock()
		events = append(events, ev)
	}})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	td := buildTraces([16]byte{20}, [16]byte{}, [8]byte{20}, "op-commit", start)
	s.AddTraces(context.Background(), td)
	s.Sync()

	ld := plog.NewLogs()
	rl := ld.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("service.name", "svc")
	sl := rl.ScopeLogs().AppendEmpty()
	lr := sl.LogRecords().AppendEmpty()
	lr.SetTimestamp(pcommon.NewTimestampFromTime(start))
	lr.Body().SetStr("committed")
	s.AddLogs(context.Background(), ld)
	s.Sync()

	mu.Lock()
	defer mu.Unlock()
	if len(events) != 2 {
		t.Fatalf("events = %d, want 2 (one per AddX call)", len(events))
	}
	if events[0].Kind != KindTraces {
		t.Errorf("events[0].Kind = %v, want KindTraces", events[0].Kind)
	}
	if len(events[0].Traces.Spans) != 1 || events[0].Traces.Spans[0].Name != "op-commit" {
		t.Errorf("events[0].Traces.Spans = %+v, want 1 span named op-commit", events[0].Traces.Spans)
	}
	if events[1].Kind != KindLogs {
		t.Errorf("events[1].Kind = %v, want KindLogs", events[1].Kind)
	}
	if len(events[1].Logs.Logs) != 1 || events[1].Logs.Logs[0].Body != "committed" {
		t.Errorf("events[1].Logs.Logs = %+v, want 1 log with body 'committed'", events[1].Logs.Logs)
	}
}

// TestStorage_OnCommit_DeliversInCommitOrder verifies that moving OnCommit
// delivery off the writer goroutine (a dedicated goroutine reached through a
// bounded channel, see Options.OnCommit) doesn't reorder events: several
// batches enqueued back-to-back without an intervening Sync must still be
// delivered in the exact order they were committed.
func TestStorage_OnCommit_DeliversInCommitOrder(t *testing.T) {
	var mu sync.Mutex
	var names []string
	s, err := Open(context.Background(), Options{OnCommit: func(_ context.Context, ev CommitEvent) {
		mu.Lock()
		defer mu.Unlock()
		for _, sp := range ev.Traces.Spans {
			names = append(names, sp.Name)
		}
	}})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })

	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	want := []string{"first", "second", "third"}
	for i, name := range want {
		td := buildTraces([16]byte{41}, [16]byte{}, [8]byte{byte(i)}, name, start)
		s.AddTraces(context.Background(), td)
	}
	s.Sync()

	mu.Lock()
	defer mu.Unlock()
	if !slices.Equal(names, want) {
		t.Errorf("commit events delivered as %v, want %v (in commit order)", names, want)
	}
}

// TestStorage_OnCommit_CloseWaitsForInFlightDelivery verifies Close's
// documented guarantee: a CommitEvent already dispatched to the delivery
// goroutine (see Options.OnCommit) fires before Close returns, even when the
// caller never called Sync first — Close itself must drain the pending
// write AND wait for the resulting delivery.
func TestStorage_OnCommit_CloseWaitsForInFlightDelivery(t *testing.T) {
	var mu sync.Mutex
	var delivered bool
	s, err := Open(context.Background(), Options{OnCommit: func(_ context.Context, _ CommitEvent) {
		mu.Lock()
		delivered = true
		mu.Unlock()
	}})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	td := buildTraces([16]byte{42}, [16]byte{}, [8]byte{42}, "op-close", start)
	s.AddTraces(context.Background(), td)

	// Deliberately no Sync(): Close alone must drain the write queue and
	// wait for the commit event it produces to be delivered.
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if !delivered {
		t.Error("OnCommit event was not delivered before Close returned")
	}
}

func TestStorage_Clear_DeletesEveryTableAndResetsCaches(t *testing.T) {
	s := openTestStorage(t, Options{})
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	td := buildTraces([16]byte{30}, [16]byte{}, [8]byte{30}, "op-clear", start)
	s.AddTraces(context.Background(), td)

	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName("cpu")
	g := m.SetEmptyGauge()
	dp := g.DataPoints().AppendEmpty()
	dp.SetDoubleValue(1)
	dp.SetTimestamp(pcommon.NewTimestampFromTime(start))
	s.AddMetrics(context.Background(), md)

	ld := plog.NewLogs()
	rl := ld.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("service.name", "svc")
	sl := rl.ScopeLogs().AppendEmpty()
	lr := sl.LogRecords().AppendEmpty()
	lr.SetTimestamp(pcommon.NewTimestampFromTime(start))
	lr.Body().SetStr("to-be-cleared")
	s.AddLogs(context.Background(), ld)
	s.Sync()

	if err := s.Clear(context.Background()); err != nil {
		t.Fatalf("Clear: %v", err)
	}

	stats, err := s.DBStats(context.Background())
	if err != nil {
		t.Fatalf("DBStats: %v", err)
	}
	if stats.Resources != 0 || stats.MetricSeries != 0 || stats.Spans != 0 || stats.MetricPoints != 0 || stats.Logs != 0 {
		t.Fatalf("DBStats after Clear = %+v, want all zero", stats)
	}

	// resourceCache must be reset too: re-adding the same resource after a
	// Clear must re-insert the dimension row rather than skip it as "known".
	s.AddTraces(context.Background(), td)
	s.Sync()
	stats, err = s.DBStats(context.Background())
	if err != nil {
		t.Fatalf("DBStats: %v", err)
	}
	if stats.Resources != 1 || stats.Spans != 1 {
		t.Fatalf("DBStats after re-add = %+v, want resources=1 spans=1", stats)
	}
}
