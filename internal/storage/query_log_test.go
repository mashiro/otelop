package storage

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
)

func buildLog(traceID [16]byte, body, service string, ts time.Time) plog.Logs {
	ld := plog.NewLogs()
	rl := ld.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("service.name", service)
	lr := rl.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	lr.SetTimestamp(pcommon.NewTimestampFromTime(ts))
	lr.SetObservedTimestamp(pcommon.NewTimestampFromTime(ts))
	lr.Body().SetStr(body)
	if traceID != ([16]byte{}) {
		lr.SetTraceID(pcommon.TraceID(traceID))
	}
	lr.Attributes().PutStr("k", "v")
	return ld
}

func TestLogsPage_NewestFirstOrdering(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddLogs(ctx, buildLog([16]byte{1}, "first", "svc", t0))
	s.AddLogs(ctx, buildLog([16]byte{1}, "second", "svc", t0.Add(time.Second)))
	s.Sync()

	items, hasNextPage, err := s.LogsPage(ctx, t0.Add(-time.Minute), t0.Add(time.Minute), nil, 0, "")
	if err != nil {
		t.Fatalf("LogsPage: %v", err)
	}
	if hasNextPage {
		t.Fatal("hasNextPage = true for unlimited query")
	}
	if len(items) != 2 || items[0].Body != "second" || items[1].Body != "first" {
		t.Fatalf("order = %+v, want [second, first] (newest ts first)", items)
	}
	if items[0].ServiceName != "svc" {
		t.Errorf("ServiceName = %q, want svc", items[0].ServiceName)
	}
	if items[0].Resource["service.name"] != "svc" {
		t.Errorf("Resource = %+v", items[0].Resource)
	}
	if items[0].Attributes["k"] != "v" {
		t.Errorf("Attributes = %+v", items[0].Attributes)
	}
}

func TestLogsPage_TimeRangeFiltering(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddLogs(ctx, buildLog([16]byte{2}, "in-range", "svc", t0))
	s.AddLogs(ctx, buildLog([16]byte{2}, "out-of-range", "svc", t0.Add(time.Hour)))
	s.Sync()

	items, hasNextPage, err := s.LogsPage(ctx, t0.Add(-time.Minute), t0.Add(time.Minute), nil, 0, "")
	if err != nil {
		t.Fatalf("LogsPage: %v", err)
	}
	if hasNextPage || len(items) != 1 || items[0].Body != "in-range" {
		t.Fatalf("expected only the in-range log, got hasNextPage=%v items=%+v", hasNextPage, items)
	}
}

func TestLogsPage_PaginationAndHasNextPage(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	for i := 0; i < 5; i++ {
		s.AddLogs(ctx, buildLog([16]byte{3}, "log", "svc", t0.Add(time.Duration(i)*time.Second)))
	}
	s.Sync()

	first, _, err := s.LogsPage(ctx, t0.Add(-time.Minute), t0.Add(time.Minute), nil, 2, "")
	if err != nil {
		t.Fatalf("LogsPage first page: %v", err)
	}
	after := &LogCursor{TS: first[len(first)-1].TS, ID: first[len(first)-1].ID}
	items, hasNextPage, err := s.LogsPage(ctx, t0.Add(-time.Minute), t0.Add(time.Minute), after, 2, "")
	if err != nil {
		t.Fatalf("LogsPage: %v", err)
	}
	if !hasNextPage {
		t.Fatal("hasNextPage = false, want true")
	}
	if len(items) != 2 {
		t.Fatalf("expected page of 2, got %d", len(items))
	}
}

// TestLogsPageByTraceID_IsolatesByTraceIgnoringTimeRange matches
// the old store package's GetLogsPageByTraceID: no time-range filter, only trace_id
// isolation. A log far outside any "recent" window must still be returned.
func TestLogsPage_EmptyPageHasNoNextPage(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	for i := 0; i < 3; i++ {
		s.AddLogs(ctx, buildLog([16]byte{8}, "log", "svc", t0.Add(time.Duration(i)*time.Second)))
	}
	s.Sync()

	items, hasNextPage, err := s.LogsPage(ctx, t0.Add(-time.Minute), t0.Add(time.Minute), &LogCursor{TS: t0.Add(-time.Hour)}, 2, "")
	if err != nil {
		t.Fatalf("LogsPage: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected an empty page past the end of the matching set, got %d items", len(items))
	}
	if hasNextPage {
		t.Fatal("hasNextPage = true for an empty page")
	}
}

func TestLogsPageByTraceID_IsolatesByTraceIgnoringTimeRange(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	old := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddLogs(ctx, buildLog([16]byte{4}, "matches", "svc", old))
	s.AddLogs(ctx, buildLog([16]byte{5}, "other-trace", "svc", time.Now()))
	s.Sync()

	traceID := pcommon.TraceID([16]byte{4}).String()
	items, hasNextPage, err := s.LogsPageByTraceID(ctx, traceID, nil, 0, "")
	if err != nil {
		t.Fatalf("LogsPageByTraceID: %v", err)
	}
	if hasNextPage || len(items) != 1 || items[0].Body != "matches" {
		t.Fatalf("expected only the matching-trace log regardless of age, got hasNextPage=%v items=%+v", hasNextPage, items)
	}
}

func TestLogsPageByTraceID_PaginationAndHasNextPage(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	for i := 0; i < 4; i++ {
		s.AddLogs(ctx, buildLog([16]byte{6}, "log", "svc", t0.Add(time.Duration(i)*time.Second)))
	}
	s.AddLogs(ctx, buildLog([16]byte{7}, "unrelated", "svc", t0))
	s.Sync()

	traceID := pcommon.TraceID([16]byte{6}).String()
	first, _, err := s.LogsPageByTraceID(ctx, traceID, nil, 1, "")
	if err != nil {
		t.Fatalf("LogsPageByTraceID first page: %v", err)
	}
	after := &LogCursor{TS: first[0].TS, ID: first[0].ID}
	items, hasNextPage, err := s.LogsPageByTraceID(ctx, traceID, after, 2, "")
	if err != nil {
		t.Fatalf("LogsPageByTraceID: %v", err)
	}
	if !hasNextPage {
		t.Fatal("hasNextPage = false, want true")
	}
	if len(items) != 2 {
		t.Fatalf("expected page of 2, got %d", len(items))
	}
}

func TestLogsPageByTraceID_SearchComposesWithTraceFilter(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddLogs(ctx, buildLog([16]byte{10}, "db timeout", "api", t0))
	s.AddLogs(ctx, buildLog([16]byte{10}, "request complete", "api", t0.Add(time.Second)))
	s.AddLogs(ctx, buildLog([16]byte{11}, "another timeout", "api", t0.Add(2*time.Second)))
	s.Sync()

	traceID := pcommon.TraceID([16]byte{10}).String()
	items, hasNextPage, err := s.LogsPageByTraceID(ctx, traceID, nil, 0, "timeout")
	if err != nil {
		t.Fatalf("LogsPageByTraceID: %v", err)
	}
	if hasNextPage || len(items) != 1 || items[0].Body != "db timeout" {
		t.Fatalf("expected the search match from only the requested trace, got hasNextPage=%v items=%+v", hasNextPage, items)
	}
}

func TestLogsPageByTraceID_EmptyPageHasNoNextPage(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	for i := 0; i < 4; i++ {
		s.AddLogs(ctx, buildLog([16]byte{9}, "log", "svc", t0.Add(time.Duration(i)*time.Second)))
	}
	s.Sync()

	traceID := pcommon.TraceID([16]byte{9}).String()
	items, hasNextPage, err := s.LogsPageByTraceID(ctx, traceID, &LogCursor{TS: t0.Add(-time.Hour)}, 2, "")
	if err != nil {
		t.Fatalf("LogsPageByTraceID: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected an empty page past the end of the matching set, got %d items", len(items))
	}
	if hasNextPage {
		t.Fatal("hasNextPage = true for an empty page")
	}
}
