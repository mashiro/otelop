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
			items, hasNextPage, err := s.LogsPage(ctx, t0.Add(-time.Minute), t0.Add(time.Minute), nil, 0, tc.search)
			if err != nil {
				t.Fatalf("LogsPage: %v", err)
			}
			if hasNextPage {
				t.Fatal("hasNextPage = true for unlimited query")
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
// doesn't affect pagination, which operates over
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

	all, hasNextPage, err := s.LogsPage(ctx, from, to, nil, 0, "heartbeat")
	if err != nil {
		t.Fatalf("LogsPage: %v", err)
	}
	if hasNextPage || len(all) != 3 {
		t.Fatalf("unlimited page: hasNextPage=%v len=%d, want false/3", hasNextPage, len(all))
	}

	page1, hasNextPage, err := s.LogsPage(ctx, from, to, nil, 2, "heartbeat")
	if err != nil {
		t.Fatalf("LogsPage page1: %v", err)
	}
	if !hasNextPage || len(page1) != 2 {
		t.Fatalf("page1: hasNextPage=%v len=%d, want true/2", hasNextPage, len(page1))
	}

	after := &LogCursor{TS: page1[len(page1)-1].TS, ID: page1[len(page1)-1].ID}
	page2, hasNextPage, err := s.LogsPage(ctx, from, to, after, 2, "heartbeat")
	if err != nil {
		t.Fatalf("LogsPage page2: %v", err)
	}
	if hasNextPage || len(page2) != 1 {
		t.Fatalf("page2: hasNextPage=%v len=%d, want false/1", hasNextPage, len(page2))
	}
}

func TestLogsPage_AttributeSearch(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	trace := [16]byte{0xAB}
	for i, service := range []string{"api", "worker", "api"} {
		ld := buildLogWithSeverity(trace, "request failed", service, "ERROR", t0.Add(time.Duration(i)*time.Second))
		attrs := ld.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0).Attributes()
		attrs.PutStr("http.method", "GET")
		attrs.PutInt("http.status_code", 500)
		attrs.PutBool("retry", false)
		attrs.PutStr("user.name", "Alice Smith")
		attrs.PutStr("literal", "100%_done*")
		attrs.PutStr("path/~key", "ok")
		attrs.PutStr("quote'key", "safe")
		attrs.PutStr("multiline", "one\ntwo")
		attrs.PutEmpty("otel.empty")
		attrs.PutStr("empty", "")
		attrs.PutStr("escaped", "say \"hello\" \\ goodbye")
		s.AddLogs(ctx, ld)
	}
	s.AddLogs(ctx, buildLogWithSeverity([16]byte{}, "unrelated", "api", "INFO", t0))
	s.Sync()
	cases := []struct {
		query string
		count int
	}{
		{"attributes.http.method:GET", 3},
		{"attributes.http.status_code:>499", 3},
		{"attributes.http.status_code:>=500", 3},
		{"attributes.http.status_code:<500", 0},
		{"attributes.http.status_code:<=500", 3},
		{"attributes.http.method:>0", 0},
		{`attributes.user.name:~"*Alice Sm*"`, 3},
		{"attributes.http.method:get", 3},
		{"attributes.http.method:GE", 0},
		{"attributes.HTTP.method:GET", 0},
		{"attributes.http.method:G*", 3},
		{"attributes.http.method:*", 3},
		{"attributes.missing:*", 0},
		{"attributes.otel.empty:*", 3},
		{"attributes.empty:*", 3},
		{`attributes.empty:""`, 3},
		{"attributes.http.status_code:500 attributes.retry:false", 3},
		{"attributes.http.method:GET AND resource.service.name:api", 2},
		{"failed attributes.http.method:GET resource.service.name:api", 2},
		{"unrelated attributes.http.method:GET", 0},
		{`attributes.user.name:"Alice Smith"`, 3},
		{`attributes.literal:"100%_done*"`, 3},
		{`attributes.literal:"100%_done"`, 0},
		{`attributes.escaped:"say \"hello\" \\ goodbye"`, 3},
		{"attributes.path/~key:ok", 3},
		{"attributes.quote'key:safe", 3},
		{`attributes.http.method:"' OR 1=1 --"`, 0},
		{"attributes.multiline:o*two", 3},
		{`attributes.http.method:"GET`, 0},
	}
	for _, tc := range cases {
		t.Run(tc.query, func(t *testing.T) {
			rows, _, err := s.LogsPage(ctx, t0.Add(-time.Second), t0.Add(time.Minute), nil, 0, tc.query)
			if err != nil {
				t.Fatal(err)
			}
			if len(rows) != tc.count {
				t.Fatalf("got %d logs, want %d", len(rows), tc.count)
			}
			rows, _, err = s.LogsPageByTraceID(ctx, pcommon.TraceID(trace).String(), nil, 0, tc.query)
			if err != nil {
				t.Fatal(err)
			}
			if len(rows) != tc.count {
				t.Fatalf("trace search got %d logs, want %d", len(rows), tc.count)
			}
		})
	}
	query := "attributes.http.method:GET resource.service.name:api"
	first, more, err := s.LogsPage(ctx, t0, t0.Add(time.Minute), nil, 1, query)
	if err != nil || !more || len(first) != 1 {
		t.Fatalf("first page: %v %v %v", first, more, err)
	}
	after := &LogCursor{TS: first[0].TS, ID: first[0].ID}
	next, more, err := s.LogsPage(ctx, t0, t0.Add(time.Minute), after, 1, query)
	if err != nil || more || len(next) != 1 || next[0].ID == first[0].ID {
		t.Fatalf("next page: %v %v %v", next, more, err)
	}
	rows, _, err := s.LogsPage(ctx, t0, t0.Add(time.Second), nil, 0, query)
	if err != nil || len(rows) != 1 {
		t.Fatalf("range: %v %v", rows, err)
	}
}

func TestLogsPage_NegativeAttributes(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now().UTC()
	trace := [16]byte{0xAB}
	for _, method := range []string{"GET", "POST", "missing"} {
		ld := buildLogWithSeverity(trace, method, "api", "INFO", now)
		attrs := ld.ResourceLogs().At(0).ScopeLogs().At(0).LogRecords().At(0).Attributes()
		if method != "missing" {
			attrs.PutStr("http.method", method)
		}
		s.AddLogs(ctx, ld)
	}
	s.Sync()
	for _, tc := range []struct {
		query string
		want  []string
	}{
		{"-attributes.http.method:GET", []string{"POST", "missing"}},
		{"-attributes.http.method:*", []string{"missing"}},
		{"-attributes.http.method:G*", []string{"POST", "missing"}},
		{"-resource.service.name:other", []string{"GET", "POST", "missing"}},
		{"-attributes.http.method:GET attributes.http.method:*", []string{"POST"}},
	} {
		t.Run(tc.query, func(t *testing.T) {
			for _, byTrace := range []bool{false, true} {
				var rows []LogDetail
				var err error
				if byTrace {
					rows, _, err = s.LogsPageByTraceID(ctx, pcommon.TraceID(trace).String(), nil, 100, tc.query)
				} else {
					rows, _, err = s.LogsPage(ctx, now.Add(-time.Second), now.Add(time.Second), nil, 100, tc.query)
				}
				if err != nil {
					t.Fatal(err)
				}
				var got []string
				for _, row := range rows {
					got = append(got, row.Body)
				}
				if !sameSet(got, tc.want) {
					t.Fatalf("got %v want %v", got, tc.want)
				}
			}
		})
	}
}

func TestLogsPage_PlainJSONSearch(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Now().UTC().Truncate(time.Second)
	for _, offset := range []time.Duration{0, time.Second, time.Hour} {
		logs := buildLogWithSeverity([16]byte{1}, "ordinary body", "api", "INFO", t0.Add(offset))
		resource := logs.ResourceLogs().At(0)
		resource.Resource().Attributes().PutStr("deployment.zone", "Tokyo-East")
		attrs := resource.ScopeLogs().At(0).LogRecords().At(0).Attributes()
		attrs.PutStr("custom.key", "100%_done")
		attrs.PutInt("attempts", 987654)
		nested := attrs.PutEmptyMap("payload")
		nested.PutStr("customer", "Alice Smith")
		nested.PutEmptySlice("tags").AppendEmpty().SetStr("nested-token")
		s.AddLogs(ctx, logs)
	}
	s.Sync()
	for _, query := range []string{"custom.key", "100%_done", "987654", "ALICE SMITH", "nested-token", "deployment.zone", "tokyo-east", "nested-token attributes.attempts:987654"} {
		t.Run(query, func(t *testing.T) {
			items, more, err := s.LogsPage(ctx, t0.Add(-time.Second), t0.Add(time.Minute), nil, 1, query)
			if err != nil || len(items) != 1 || !more {
				t.Fatalf("page: items=%d more=%v err=%v", len(items), more, err)
			}
			cursor := &LogCursor{TS: items[0].TS, ID: items[0].ID}
			items, more, err = s.LogsPage(ctx, t0.Add(-time.Second), t0.Add(time.Minute), cursor, 1, query)
			if err != nil || len(items) != 1 || more {
				t.Fatalf("next page: items=%d more=%v err=%v", len(items), more, err)
			}
		})
	}
	for _, query := range []string{"100X_done", "nested-missing", "nested-token attributes.attempts:1"} {
		items, _, err := s.LogsPage(ctx, t0.Add(-time.Second), t0.Add(time.Minute), nil, 100, query)
		if err != nil || len(items) != 0 {
			t.Fatalf("query %q: items=%d err=%v", query, len(items), err)
		}
	}
}
