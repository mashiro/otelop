package storage

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
)

// buildLogWithSeverity extends buildLog (query_log_test.go) with an explicit
// severity text, needed to test search-by-severity in isolation.
func buildLogWithSeverity(traceID [16]byte, body, service, severity string, ts time.Time) plog.Logs {
	ld := plog.NewLogs()
	rl := ld.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("service.name", service)
	lr := rl.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	lr.SetTimestamp(pcommon.NewTimestampFromTime(ts))
	lr.SetObservedTimestamp(pcommon.NewTimestampFromTime(ts))
	lr.Body().SetStr(body)
	lr.SetSeverityText(severity)
	if traceID != ([16]byte{}) {
		lr.SetTraceID(pcommon.TraceID(traceID))
	}
	return ld
}

// TestLogsPage_SearchMatchesByField is the table-driven core of issue #161's
// log search: each case searches for text that should resolve to exactly
// one field on exactly one log record, confirming search matches body,
// resource service name, severity text, and trace ID, is case-insensitive,
// escapes ILIKE metacharacters literally, and an empty search is a no-op.
func TestLogsPage_SearchMatchesByField(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	traceA := [16]byte{0xAA, 0x01}
	s.AddLogs(ctx, buildLogWithSeverity(traceA, "payment declined", "checkout-svc", "ERROR", t0))
	s.AddLogs(ctx, buildLogWithSeverity([16]byte{}, "cache warmed", "inventory-svc", "INFO", t0.Add(time.Second)))
	s.AddLogs(ctx, buildLogWithSeverity([16]byte{}, "applied 100% discount", "billing-svc", "INFO", t0.Add(2*time.Second)))
	s.AddLogs(ctx, buildLogWithSeverity([16]byte{}, "applied 100X discount", "billing-svc", "INFO", t0.Add(3*time.Second)))
	s.Sync()

	idA := pcommon.TraceID(traceA).String()

	cases := []struct {
		name   string
		search string
		want   []string
	}{
		{"body", "payment declined", []string{"payment declined"}},
		{"case-insensitive body", "PAYMENT DECLINED", []string{"payment declined"}},
		{"service name", "inventory-svc", []string{"cache warmed"}},
		{"severity text", "ERROR", []string{"payment declined"}},
		{"trace ID", idA[:4], []string{"payment declined"}},
		{"% is escaped, matches only the literal percent", "100%", []string{"applied 100% discount"}},
		{"no match", "no-such-log-anywhere", nil},
		{
			"empty search matches everything",
			"",
			[]string{"payment declined", "cache warmed", "applied 100% discount", "applied 100X discount"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			items, total, err := s.LogsPage(ctx, t0.Add(-time.Minute), t0.Add(time.Minute), 0, 0, tc.search)
			if err != nil {
				t.Fatalf("LogsPage: %v", err)
			}
			if total != len(tc.want) {
				t.Fatalf("total = %d, want %d", total, len(tc.want))
			}
			got := make([]string, len(items))
			for i, it := range items {
				got[i] = it.Body
			}
			if !sameSet(got, tc.want) {
				t.Errorf("bodies = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestLogsPage_SearchComposesWithRangeAndPagination mirrors
// TestTracesPage_SearchComposesWithRangeAndPagination: a search-matching log
// outside the time window is excluded, a non-matching log inside the window
// doesn't count toward the total, and pagination/total both operate over
// the search-narrowed set.
func TestLogsPage_SearchComposesWithRangeAndPagination(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	for i := 0; i < 3; i++ {
		s.AddLogs(ctx, buildLog([16]byte{}, "worker heartbeat", "worker-svc", t0.Add(time.Duration(i)*time.Second)))
	}
	s.AddLogs(ctx, buildLog([16]byte{}, "worker heartbeat", "worker-svc", t0.Add(time.Hour)))
	s.AddLogs(ctx, buildLog([16]byte{}, "unrelated log", "other-svc", t0))
	s.Sync()

	from, to := t0.Add(-time.Minute), t0.Add(time.Minute)

	_, total, err := s.LogsPage(ctx, from, to, 0, 0, "heartbeat")
	if err != nil {
		t.Fatalf("LogsPage: %v", err)
	}
	if total != 3 {
		t.Fatalf("total = %d, want 3 (the out-of-range match excluded, the in-range non-match excluded)", total)
	}

	page1, total, err := s.LogsPage(ctx, from, to, 0, 2, "heartbeat")
	if err != nil {
		t.Fatalf("LogsPage page1: %v", err)
	}
	if total != 3 || len(page1) != 2 {
		t.Fatalf("page1: total=%d len=%d, want total=3 len=2", total, len(page1))
	}

	page2, total, err := s.LogsPage(ctx, from, to, 2, 2, "heartbeat")
	if err != nil {
		t.Fatalf("LogsPage page2: %v", err)
	}
	if total != 3 || len(page2) != 1 {
		t.Fatalf("page2: total=%d len=%d, want total=3 len=1 (the third match reachable via offset)", total, len(page2))
	}
}
