package storage

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

// spanSpec describes one span to build via buildTracesMulti. Each spec gets
// its own ResourceSpans entry (service attribute optional), letting tests
// build traces with spans from different services or with no resource
// attributes at all.
type spanSpec struct {
	traceID    [16]byte
	spanID     [8]byte
	parentID   [8]byte // zero value ([8]byte{}) means "root" (empty ParentSpanID)
	name       string
	start, end time.Time
	isError    bool
	service    string
}

func buildTracesMulti(specs ...spanSpec) ptrace.Traces {
	td := ptrace.NewTraces()
	for _, sp := range specs {
		rs := td.ResourceSpans().AppendEmpty()
		if sp.service != "" {
			rs.Resource().Attributes().PutStr("service.name", sp.service)
		}
		span := rs.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
		span.SetTraceID(pcommon.TraceID(sp.traceID))
		span.SetSpanID(pcommon.SpanID(sp.spanID))
		if sp.parentID != ([8]byte{}) {
			span.SetParentSpanID(pcommon.SpanID(sp.parentID))
		}
		span.SetName(sp.name)
		span.SetStartTimestamp(pcommon.NewTimestampFromTime(sp.start))
		span.SetEndTimestamp(pcommon.NewTimestampFromTime(sp.end))
		if sp.isError {
			span.Status().SetCode(ptrace.StatusCodeError)
		}
	}
	return td
}

func TestTracesPage_DedupsRepeatedSpans(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	td := buildTracesMulti(spanSpec{
		traceID: [16]byte{1}, spanID: [8]byte{1},
		name: "op", start: base, end: base.Add(10 * time.Millisecond), service: "svc",
	})
	// Simulate an OTLP re-send of the exact same span.
	s.AddTraces(ctx, td)
	s.AddTraces(ctx, td)
	s.Sync()

	items, hasNextPage, err := s.TracesPage(ctx, base.Add(-time.Minute), base.Add(time.Minute), nil, 0, "")
	if err != nil {
		t.Fatalf("TracesPage: %v", err)
	}
	if hasNextPage {
		t.Fatal("hasNextPage = true for an unlimited query")
	}
	if len(items) != 1 || items[0].SpanCount != 1 {
		t.Fatalf("expected 1 trace with span_count=1 after dedup, got %+v", items)
	}
}

// TestTracesPage_MultiRootPicksLongestDurationAsRoot mirrors
// the old store package's TestConvertTraces_MultiRoot: a short turn/start root
// coexists with a long-running session_task.turn root and its child. The
// longest parentless span must be picked as root, and Duration must cover
// the full trace range (not just the root's own span).
func TestTracesPage_MultiRootPicksLongestDurationAsRoot(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	td := buildTracesMulti(
		spanSpec{
			traceID: [16]byte{2}, spanID: [8]byte{1},
			name: "turn/start", start: base, end: base.Add(2 * time.Millisecond), service: "codex",
		},
		spanSpec{
			traceID: [16]byte{2}, spanID: [8]byte{2},
			name: "session_task.turn", start: base.Add(time.Millisecond), end: base.Add(800 * time.Millisecond), service: "codex",
		},
		spanSpec{
			traceID: [16]byte{2}, spanID: [8]byte{3}, parentID: [8]byte{2},
			name: "receiving_stream", start: base.Add(50 * time.Millisecond), end: base.Add(950 * time.Millisecond), service: "codex",
		},
	)
	s.AddTraces(ctx, td)
	s.Sync()

	items, _, err := s.TracesPage(ctx, base.Add(-time.Minute), base.Add(time.Minute), nil, 0, "")
	if err != nil {
		t.Fatalf("TracesPage: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 trace, got %d", len(items))
	}
	got := items[0]
	if got.SpanCount != 3 {
		t.Errorf("SpanCount = %d, want 3", got.SpanCount)
	}
	if !got.HasRoot || got.RootName != "session_task.turn" {
		t.Errorf("RootName = %q (HasRoot=%v), want session_task.turn (longest parentless span)", got.RootName, got.HasRoot)
	}
	if want := 950 * time.Millisecond; got.Duration != want {
		t.Errorf("Duration = %v, want %v (full range from earliest start to latest end)", got.Duration, want)
	}
	if !got.StartTime.Equal(base) {
		t.Errorf("StartTime = %v, want %v", got.StartTime, base)
	}
	if got.ServiceName != "codex" {
		t.Errorf("ServiceName = %q, want codex", got.ServiceName)
	}
}

// TestTracesPage_RootlessFallsBackToEarliestStartedSpanService mirrors
// the old store package's TestConvertTraces_RootlessMultiServiceUsesEarliestStart:
// every span has a (dangling) parent, so there's no root; ServiceName must
// come from the earliest-started span, not resource iteration order.
func TestTracesPage_RootlessFallsBackToEarliestStartedSpanService(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	td := buildTracesMulti(
		spanSpec{
			traceID: [16]byte{3}, spanID: [8]byte{1}, parentID: [8]byte{0xAA},
			name: "late-span", start: base.Add(20 * time.Millisecond), end: base.Add(40 * time.Millisecond), service: "late-service",
		},
		spanSpec{
			traceID: [16]byte{3}, spanID: [8]byte{2}, parentID: [8]byte{0xBB},
			name: "early-span", start: base, end: base.Add(10 * time.Millisecond), service: "early-service",
		},
	)
	s.AddTraces(ctx, td)
	s.Sync()

	items, _, err := s.TracesPage(ctx, base.Add(-time.Minute), base.Add(time.Minute), nil, 0, "")
	if err != nil {
		t.Fatalf("TracesPage: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 trace, got %d", len(items))
	}
	got := items[0]
	if got.HasRoot {
		t.Errorf("HasRoot = true, want false (no parentless spans)")
	}
	if got.ServiceName != "early-service" {
		t.Errorf("ServiceName = %q, want early-service (earliest start)", got.ServiceName)
	}
	if want := 40 * time.Millisecond; got.Duration != want {
		t.Errorf("Duration = %v, want %v", got.Duration, want)
	}
}

func TestTracesPage_HasErrorTrueWhenAnySpanErrors(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	td := buildTracesMulti(
		spanSpec{traceID: [16]byte{4}, spanID: [8]byte{1}, name: "ok", start: base, end: base.Add(time.Millisecond), service: "svc"},
		spanSpec{traceID: [16]byte{4}, spanID: [8]byte{2}, name: "bad", start: base, end: base.Add(time.Millisecond), isError: true, service: "svc"},
	)
	s.AddTraces(ctx, td)
	s.Sync()

	items, _, err := s.TracesPage(ctx, base.Add(-time.Minute), base.Add(time.Minute), nil, 0, "")
	if err != nil {
		t.Fatalf("TracesPage: %v", err)
	}
	if len(items) != 1 || !items[0].HasError {
		t.Fatalf("expected HasError=true, got %+v", items)
	}
}

// A trace belongs to the window containing its earliest span, even when a
// later child span starts in another window. Its summary still covers the
// complete span set.
func TestTracesPage_WindowUsesTraceStartAndAggregatesFullSpanSet(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	// One span starts well before the query window, one starts inside it.
	td := buildTracesMulti(
		spanSpec{
			traceID: [16]byte{5}, spanID: [8]byte{1},
			name: "before-window", start: base, end: base.Add(time.Millisecond), service: "svc",
		},
		spanSpec{
			traceID: [16]byte{5}, spanID: [8]byte{2},
			name: "in-window", start: base.Add(time.Hour), end: base.Add(time.Hour + time.Millisecond), service: "svc",
		},
	)
	s.AddTraces(ctx, td)
	s.Sync()

	from := base.Add(-time.Minute)
	to := base.Add(time.Minute)
	items, hasNextPage, err := s.TracesPage(ctx, from, to, nil, 0, "")
	if err != nil {
		t.Fatalf("TracesPage: %v", err)
	}
	if hasNextPage {
		t.Fatal("hasNextPage = true for an unlimited query")
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 trace, got %d", len(items))
	}
	got := items[0]
	if got.SpanCount != 2 {
		t.Errorf("SpanCount = %d, want 2 (aggregation must cover the full span set, not just the in-range span)", got.SpanCount)
	}
	if !got.StartTime.Equal(base) {
		t.Errorf("StartTime = %v, want %v", got.StartTime, base)
	}
	if want := time.Hour + time.Millisecond; got.Duration != want {
		t.Errorf("Duration = %v, want %v (full range across both spans)", got.Duration, want)
	}

	// The child span starts in this later window, but the trace does not belong
	// here because its start time is the earlier span's timestamp.
	laterFrom := base.Add(59 * time.Minute)
	laterTo := base.Add(61 * time.Minute)
	items, hasNextPage, err = s.TracesPage(ctx, laterFrom, laterTo, nil, 0, "")
	if err != nil {
		t.Fatalf("TracesPage (child-span window): %v", err)
	}
	if hasNextPage || len(items) != 0 {
		t.Errorf("expected no traces in the child-span window, got hasNextPage=%v items=%d", hasNextPage, len(items))
	}
}

func TestTracesPage_PaginationAndHasNextPage(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	for i := 0; i < 5; i++ {
		td := buildTracesMulti(spanSpec{
			traceID: [16]byte{6, byte(i)}, spanID: [8]byte{byte(i)},
			name: "op", start: base, end: base.Add(time.Millisecond), service: "svc",
		})
		s.AddTraces(ctx, td)
		s.Sync()
		time.Sleep(time.Millisecond) // force distinct ingested_at for ordering
	}

	first, _, err := s.TracesPage(ctx, base.Add(-time.Minute), base.Add(time.Minute), nil, 2, "")
	if err != nil {
		t.Fatalf("TracesPage first page: %v", err)
	}
	last := first[len(first)-1]
	after := &TraceCursor{StartTime: last.StartTime, FirstSeen: last.FirstSeen, TraceID: last.TraceID}
	items, hasNextPage, err := s.TracesPage(ctx, base.Add(-time.Minute), base.Add(time.Minute), after, 2, "")
	if err != nil {
		t.Fatalf("TracesPage: %v", err)
	}
	if !hasNextPage {
		t.Fatal("hasNextPage = false, want true")
	}
	if len(items) != 2 {
		t.Fatalf("expected page of 2, got %d", len(items))
	}
}

func TestTracesPage_EmptyPageHasNoNextPage(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	for i := 0; i < 3; i++ {
		td := buildTracesMulti(spanSpec{
			traceID: [16]byte{10, byte(i)}, spanID: [8]byte{byte(i)},
			name: "op", start: base, end: base.Add(time.Millisecond), service: "svc",
		})
		s.AddTraces(ctx, td)
	}
	s.Sync()

	items, hasNextPage, err := s.TracesPage(ctx, base.Add(-time.Minute), base.Add(time.Minute), &TraceCursor{
		StartTime: base.Add(-time.Hour), FirstSeen: time.Unix(0, 0).UTC(),
	}, 2, "")
	if err != nil {
		t.Fatalf("TracesPage: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected an empty page past the end of the matching set, got %d items", len(items))
	}
	if hasNextPage {
		t.Fatal("hasNextPage = true for an empty page past the end")
	}
}

func TestTracesPage_OrderingNewestTraceStartFirst(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	first := buildTracesMulti(spanSpec{traceID: [16]byte{7, 1}, spanID: [8]byte{1}, name: "later-start", start: base.Add(time.Second), end: base.Add(time.Second + time.Millisecond), service: "svc"})
	s.AddTraces(ctx, first)
	s.Sync()
	time.Sleep(2 * time.Millisecond)

	second := buildTracesMulti(spanSpec{traceID: [16]byte{7, 2}, spanID: [8]byte{2}, name: "earlier-start", start: base, end: base.Add(time.Millisecond), service: "svc"})
	s.AddTraces(ctx, second)
	s.Sync()

	items, _, err := s.TracesPage(ctx, base.Add(-time.Minute), base.Add(time.Minute), nil, 0, "")
	if err != nil {
		t.Fatalf("TracesPage: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 traces, got %d", len(items))
	}
	if items[0].RootName != "later-start" || items[1].RootName != "earlier-start" {
		t.Errorf("order = [%s, %s], want newest trace start first", items[0].RootName, items[1].RootName)
	}
}

func TestTraceSummariesByIDs_BatchesAndIgnoresMissingIDs(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	firstID := pcommon.TraceID([16]byte{20}).String()
	secondID := pcommon.TraceID([16]byte{21}).String()
	s.AddTraces(ctx, buildTracesMulti(
		spanSpec{traceID: [16]byte{20}, spanID: [8]byte{1}, name: "first-root", start: base, end: base.Add(5 * time.Millisecond), service: "first"},
		spanSpec{traceID: [16]byte{20}, spanID: [8]byte{2}, parentID: [8]byte{1}, name: "first-child", start: base.Add(time.Millisecond), end: base.Add(8 * time.Millisecond), isError: true, service: "first"},
		spanSpec{traceID: [16]byte{21}, spanID: [8]byte{3}, name: "second-root", start: base.Add(time.Second), end: base.Add(time.Second + 3*time.Millisecond), service: "second"},
	))
	s.Sync()

	items, err := s.TraceSummariesByIDs(ctx, []string{firstID, "missing", secondID})
	if err != nil {
		t.Fatalf("TraceSummariesByIDs: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("summaries = %d, want 2", len(items))
	}
	byID := make(map[string]TraceSummary, len(items))
	for _, item := range items {
		byID[item.TraceID] = item
	}
	first := byID[firstID]
	if first.SpanCount != 2 || !first.HasError || first.RootName != "first-root" || first.ServiceName != "first" {
		t.Errorf("first summary = %+v", first)
	}
	if first.Duration != 8*time.Millisecond {
		t.Errorf("first duration = %v, want 8ms", first.Duration)
	}
	second := byID[secondID]
	if second.SpanCount != 1 || second.RootName != "second-root" || second.ServiceName != "second" {
		t.Errorf("second summary = %+v", second)
	}
}

func TestTraceSummariesWithRows_IncludesPendingRowsWithoutPersistingThem(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	traceID := pcommon.TraceID([16]byte{22}).String()
	rootID := pcommon.SpanID([8]byte{1}).String()

	s.AddTraces(ctx, buildTracesMulti(spanSpec{
		traceID: [16]byte{22}, spanID: [8]byte{1}, name: "root",
		start: base, end: base.Add(5 * time.Millisecond), service: "svc",
	}))
	s.Sync()

	var resourceHash uint64
	if err := s.writer.QueryRowContext(ctx, `SELECT resource_hash FROM spans WHERE trace_id = ?`, traceID).Scan(&resourceHash); err != nil {
		t.Fatal(err)
	}
	pendingAt := time.Now()
	items, err := s.traceSummariesWithRows(ctx, s.writer, []SpanRow{
		{
			TraceID: traceID, SpanID: rootID, Name: "duplicate root",
			StartTS: base, EndTS: base.Add(time.Second), ResourceHash: resourceHash,
		},
		{
			TraceID: traceID, SpanID: pcommon.SpanID([8]byte{2}).String(), ParentSpanID: rootID,
			Name: "pending child", StartTS: base.Add(-time.Millisecond), EndTS: base.Add(10 * time.Millisecond),
			StatusCode: "Error", ResourceHash: resourceHash,
		},
	}, pendingAt)
	if err != nil {
		t.Fatalf("traceSummariesWithRows: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("summaries = %d, want 1", len(items))
	}
	got := items[0]
	if got.SpanCount != 2 || !got.HasError || got.RootName != "root" || got.ServiceName != "svc" {
		t.Errorf("summary = %+v", got)
	}
	if got.StartTime != base.Add(-time.Millisecond) || got.Duration != 11*time.Millisecond {
		t.Errorf("range = %v + %v, want %v + 11ms", got.StartTime, got.Duration, base.Add(-time.Millisecond))
	}

	var persisted int
	if err := s.writer.QueryRowContext(ctx, `SELECT count(*) FROM spans WHERE trace_id = ?`, traceID).Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	if persisted != 1 {
		t.Fatalf("persisted spans = %d, pending rows became visible", persisted)
	}
}

func TestTraceByID_ReturnsAllSpansAndMatchesSummary(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "svc")
	ss := rs.ScopeSpans().AppendEmpty()

	root := ss.Spans().AppendEmpty()
	root.SetTraceID(pcommon.TraceID([16]byte{8}))
	root.SetSpanID(pcommon.SpanID([8]byte{1}))
	root.SetName("root-op")
	root.SetKind(ptrace.SpanKindServer)
	root.SetStartTimestamp(pcommon.NewTimestampFromTime(base))
	root.SetEndTimestamp(pcommon.NewTimestampFromTime(base.Add(100 * time.Millisecond)))
	root.Attributes().PutStr("http.method", "GET")
	ev := root.Events().AppendEmpty()
	ev.SetName("exception")
	ev.SetTimestamp(pcommon.NewTimestampFromTime(base.Add(time.Millisecond)))
	ev.Attributes().PutStr("exception.type", "Boom")

	child := ss.Spans().AppendEmpty()
	child.SetTraceID(pcommon.TraceID([16]byte{8}))
	child.SetSpanID(pcommon.SpanID([8]byte{2}))
	child.SetParentSpanID(pcommon.SpanID([8]byte{1}))
	child.SetName("child-op")
	child.SetStartTimestamp(pcommon.NewTimestampFromTime(base.Add(10 * time.Millisecond)))
	child.SetEndTimestamp(pcommon.NewTimestampFromTime(base.Add(50 * time.Millisecond)))

	s.AddTraces(ctx, td)
	s.Sync()

	detail, ok, err := s.TraceByID(ctx, pcommon.TraceID([16]byte{8}).String())
	if err != nil {
		t.Fatalf("TraceByID: %v", err)
	}
	if !ok {
		t.Fatal("TraceByID ok = false, want true")
	}
	if len(detail.Spans) != 2 {
		t.Fatalf("expected 2 spans, got %d", len(detail.Spans))
	}
	if detail.Spans[0].SpanID != root.SpanID().String() {
		t.Errorf("spans[0] = %q, want root (ordered by start_ts)", detail.Spans[0].SpanID)
	}
	if detail.Spans[0].Attributes["http.method"] != "GET" {
		t.Errorf("root attributes = %+v, want http.method=GET", detail.Spans[0].Attributes)
	}
	if len(detail.Spans[0].Events) != 1 || detail.Spans[0].Events[0].Name != "exception" {
		t.Fatalf("root events = %+v, want 1 exception event", detail.Spans[0].Events)
	}
	if !detail.Spans[0].Events[0].Timestamp.Equal(base.Add(time.Millisecond)) {
		t.Errorf("event timestamp = %v, want %v", detail.Spans[0].Events[0].Timestamp, base.Add(time.Millisecond))
	}
	if detail.Spans[0].Events[0].Attributes["exception.type"] != "Boom" {
		t.Errorf("event attributes = %+v", detail.Spans[0].Events[0].Attributes)
	}
	if detail.Spans[0].ServiceName != "svc" {
		t.Errorf("ServiceName = %q, want svc", detail.Spans[0].ServiceName)
	}
	if detail.Spans[0].Resource["service.name"] != "svc" {
		t.Errorf("Resource = %+v, want service.name=svc", detail.Spans[0].Resource)
	}

	if detail.RootName != "root-op" || detail.RootKind != "Server" {
		t.Errorf("RootName/RootKind = %q/%q, want root-op/Server", detail.RootName, detail.RootKind)
	}
	if want := 100 * time.Millisecond; detail.Duration != want {
		t.Errorf("Duration = %v, want %v", detail.Duration, want)
	}
	if detail.SpanCount != 2 {
		t.Errorf("SpanCount = %d, want 2", detail.SpanCount)
	}
}

func TestTraceByID_DedupsRepeatedSpans(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	td := buildTracesMulti(spanSpec{traceID: [16]byte{9}, spanID: [8]byte{1}, name: "op", start: base, end: base.Add(time.Millisecond), service: "svc"})
	s.AddTraces(ctx, td)
	s.AddTraces(ctx, td)
	s.Sync()

	detail, ok, err := s.TraceByID(ctx, pcommon.TraceID([16]byte{9}).String())
	if err != nil {
		t.Fatalf("TraceByID: %v", err)
	}
	if !ok {
		t.Fatal("ok = false, want true")
	}
	if len(detail.Spans) != 1 {
		t.Fatalf("expected 1 span after dedup, got %d", len(detail.Spans))
	}
}

func TestTraceByID_NotFound(t *testing.T) {
	s := openTestStorage(t, Options{})
	_, ok, err := s.TraceByID(context.Background(), "does-not-exist")
	if err != nil {
		t.Fatalf("TraceByID: %v", err)
	}
	if ok {
		t.Error("ok = true, want false for an unknown trace id")
	}
}
