package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
)

// TestCounts_CountsDistinctTracesMetricsAndRawLogs verifies Counts mirrors
// the old store package's Store.Len() granularity: distinct trace groups (not raw
// span rows), distinct (service, metric) groups (not raw data points), and
// raw log rows.
func TestCounts_CountsDistinctTracesMetricsAndRawLogs(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	// One trace, two spans -> traces=1.
	td := buildTracesMulti(
		spanSpec{traceID: [16]byte{1}, spanID: [8]byte{1}, name: "a", start: t0, end: t0.Add(time.Millisecond), service: "svc"},
		spanSpec{traceID: [16]byte{1}, spanID: [8]byte{2}, parentID: [8]byte{1}, name: "b", start: t0, end: t0.Add(time.Millisecond), service: "svc"},
	)
	s.AddTraces(ctx, td)

	// One metric, two attribute series -> metrics=1.
	s.AddMetrics(ctx, buildCumulativeSum("m", "svc", 1, t0))
	s.AddMetrics(ctx, buildCumulativeSum("m", "svc", 2, t0.Add(time.Second)))

	// Three raw log rows -> logs=3.
	s.AddLogs(ctx, buildLog([16]byte{2}, "l1", "svc", t0))
	s.AddLogs(ctx, buildLog([16]byte{2}, "l2", "svc", t0.Add(time.Second)))
	s.AddLogs(ctx, buildLog([16]byte{2}, "l3", "svc", t0.Add(2*time.Second)))
	s.Sync()

	traces, metrics, logs, err := s.Counts(ctx)
	if err != nil {
		t.Fatalf("Counts: %v", err)
	}
	if traces != 1 {
		t.Errorf("traces = %d, want 1", traces)
	}
	if metrics != 1 {
		t.Errorf("metrics = %d, want 1", metrics)
	}
	if logs != 3 {
		t.Errorf("logs = %d, want 3", logs)
	}
}

func TestDBStats_ReportsPerTableCounts(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	td := buildTracesMulti(spanSpec{traceID: [16]byte{1}, spanID: [8]byte{1}, name: "a", start: t0, end: t0.Add(time.Millisecond), service: "svc"})
	s.AddTraces(ctx, td)
	s.AddMetrics(ctx, buildCumulativeSum("m", "svc", 1, t0))
	s.AddLogs(ctx, buildLog([16]byte{2}, "l", "svc", t0))
	s.Sync()

	stats, err := s.DBStats(ctx)
	if err != nil {
		t.Fatalf("DBStats: %v", err)
	}
	if stats.Spans != 1 {
		t.Errorf("Spans = %d, want 1", stats.Spans)
	}
	if stats.MetricPoints != 1 {
		t.Errorf("MetricPoints = %d, want 1", stats.MetricPoints)
	}
	if stats.Logs != 1 {
		t.Errorf("Logs = %d, want 1", stats.Logs)
	}
	if stats.Resources != 1 {
		t.Errorf("Resources = %d, want 1 (svc resource shared by the span and log)", stats.Resources)
	}
	if stats.MetricSeries != 1 {
		t.Errorf("MetricSeries = %d, want 1", stats.MetricSeries)
	}
	if stats.FileBacked {
		t.Error("FileBacked = true, want false for an in-memory database")
	}
	if stats.FileSizeBytes != 0 {
		t.Errorf("FileSizeBytes = %d, want 0 for an in-memory database", stats.FileSizeBytes)
	}
}

func TestDBStats_FileBackedReportsSize(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "otelop.duckdb")
	s := openTestStorage(t, Options{Path: path})
	ctx := context.Background()

	td := buildTracesMulti(spanSpec{
		traceID: [16]byte{1}, spanID: [8]byte{1}, name: "a",
		start: time.Now(), end: time.Now().Add(time.Millisecond), service: "svc",
	})
	s.AddTraces(ctx, td)
	s.Sync()
	if err := s.Sweep(ctx); err != nil { // forces a CHECKPOINT so the file reflects the write
		t.Fatalf("Sweep: %v", err)
	}

	stats, err := s.DBStats(ctx)
	if err != nil {
		t.Fatalf("DBStats: %v", err)
	}
	if !stats.FileBacked {
		t.Error("FileBacked = false, want true for a file-backed database")
	}
	if stats.FileSizeBytes <= 0 {
		t.Errorf("FileSizeBytes = %d, want > 0", stats.FileSizeBytes)
	}
}

func TestLikePattern_EscapesWildcardMetacharacters(t *testing.T) {
	cases := []struct {
		name, search, want string
	}{
		{"plain text", "hello", "%hello%"},
		{"percent literal", "100%", `%100\%%`},
		{"underscore literal", "a_b", `%a\_b%`},
		{"backslash literal", `a\b`, `%a\\b%`},
		{"empty search matches everything", "", "%%"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := likePattern(tc.search); got != tc.want {
				t.Errorf("likePattern(%q) = %q, want %q", tc.search, got, tc.want)
			}
		})
	}
}

// TestTraceByID_UsesSameTraceIDFormat is a small sanity check that
// TraceByID's traceID argument matches pcommon.TraceID.String() formatting,
// since that's what callers (GraphQL args, WebSocket correlation) pass.
func TestTraceByID_UsesSameTraceIDFormat(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	raw := [16]byte{0xAB, 0xCD}

	td := buildTracesMulti(spanSpec{traceID: raw, spanID: [8]byte{1}, name: "a", start: time.Now(), end: time.Now().Add(time.Millisecond), service: "svc"})
	s.AddTraces(ctx, td)
	s.Sync()

	_, ok, err := s.TraceByID(ctx, pcommon.TraceID(raw).String())
	if err != nil {
		t.Fatalf("TraceByID: %v", err)
	}
	if !ok {
		t.Error("ok = false, want true using pcommon.TraceID.String() formatting")
	}
}
