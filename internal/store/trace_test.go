package store

import (
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

func TestTraceData_Merge_DeduplicatesSpansAndPromotesRoot(t *testing.T) {
	t0 := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	t1 := t0.Add(10 * time.Millisecond)
	t2 := t0.Add(5 * time.Millisecond)

	base := &TraceData{
		TraceID: "abc",
		Spans: []*SpanData{
			{SpanID: "a", StartTime: t0, EndTime: t1},
		},
		SpanCount:   1,
		StartTime:   t0,
		ServiceName: "",
	}

	incoming := &TraceData{
		TraceID: "abc",
		Spans: []*SpanData{
			{SpanID: "a", StartTime: t0, EndTime: t1}, // duplicate, should drop
			{SpanID: "b", StartTime: t2, EndTime: t1}, // new
		},
		RootSpan:    &SpanData{SpanID: "b", StartTime: t2, EndTime: t1, Duration: t1.Sub(t2)},
		ServiceName: "svc-b",
		Duration:    t1.Sub(t2),
		StartTime:   t2,
	}

	base.Merge(incoming)

	if len(base.Spans) != 2 {
		t.Fatalf("expected 2 spans after merge, got %d", len(base.Spans))
	}
	if base.SpanCount != 2 {
		t.Errorf("SpanCount = %d, want 2", base.SpanCount)
	}
	if base.RootSpan == nil || base.RootSpan.SpanID != "b" {
		t.Errorf("RootSpan not promoted: %+v", base.RootSpan)
	}
	if base.ServiceName != "svc-b" {
		t.Errorf("ServiceName = %q, want svc-b", base.ServiceName)
	}
	// base.StartTime (t0) is earlier than incoming.StartTime (t2); must not regress.
	if !base.StartTime.Equal(t0) {
		t.Errorf("StartTime = %v, want %v (base is earlier)", base.StartTime, t0)
	}
	// Duration covers the full trace range (t0 → t1), not the new root span's
	// own 5ms duration. The merged trace spans 10ms from earliest start to
	// latest end.
	if want := t1.Sub(t0); base.Duration != want {
		t.Errorf("Duration = %v, want %v (full range)", base.Duration, want)
	}
}

func TestTraceData_Merge_PreservesRootWhenIncomingHasNone(t *testing.T) {
	t0 := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	rootSpan := &SpanData{SpanID: "root", StartTime: t0, EndTime: t0.Add(100 * time.Millisecond)}
	base := &TraceData{
		TraceID:     "abc",
		Spans:       []*SpanData{rootSpan},
		RootSpan:    rootSpan,
		ServiceName: "svc",
		SpanCount:   1,
		StartTime:   t0,
		Duration:    100 * time.Millisecond,
	}

	incoming := &TraceData{
		TraceID: "abc",
		Spans: []*SpanData{
			{SpanID: "child", StartTime: t0.Add(10 * time.Millisecond), EndTime: t0.Add(20 * time.Millisecond)},
		},
		StartTime: t0.Add(10 * time.Millisecond),
	}

	base.Merge(incoming)

	if base.RootSpan == nil || base.RootSpan.SpanID != "root" {
		t.Errorf("RootSpan should remain root, got %+v", base.RootSpan)
	}
	if base.ServiceName != "svc" {
		t.Errorf("ServiceName should remain svc, got %q", base.ServiceName)
	}
	if !base.StartTime.Equal(t0) {
		t.Errorf("StartTime should remain %v, got %v", t0, base.StartTime)
	}
	if len(base.Spans) != 2 {
		t.Errorf("expected 2 spans, got %d", len(base.Spans))
	}
}

func TestTraceData_Merge_AdvancesStartTimeBackwards(t *testing.T) {
	t0 := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	earlier := t0.Add(-1 * time.Second)

	base := &TraceData{
		TraceID:   "abc",
		Spans:     []*SpanData{{SpanID: "a", StartTime: t0}},
		SpanCount: 1,
		StartTime: t0,
	}
	incoming := &TraceData{
		TraceID:   "abc",
		Spans:     []*SpanData{{SpanID: "b", StartTime: earlier}},
		StartTime: earlier,
	}

	base.Merge(incoming)

	if !base.StartTime.Equal(earlier) {
		t.Errorf("StartTime should be rolled back to %v, got %v", earlier, base.StartTime)
	}
}

// TestTraceData_Merge_MultiRootDurationUsesFullRange mirrors Codex-style
// traces where a short turn/start root span coexists with a long-running
// sibling branch (e.g. session_task.turn). Merge must report the full trace
// range and surface the longest parentless span as the representative root.
func TestTraceData_Merge_MultiRootDurationUsesFullRange(t *testing.T) {
	t0 := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	shortRoot := &SpanData{
		SpanID:    "turn-start",
		Name:      "turn/start",
		StartTime: t0,
		EndTime:   t0.Add(2 * time.Millisecond),
		Duration:  2 * time.Millisecond,
	}
	longRoot := &SpanData{
		SpanID:    "session-task-turn",
		Name:      "session_task.turn",
		StartTime: t0.Add(1 * time.Millisecond),
		EndTime:   t0.Add(900 * time.Millisecond),
		Duration:  899 * time.Millisecond,
	}
	childOfLongRoot := &SpanData{
		SpanID:       "receiving-stream",
		Name:         "receiving_stream",
		ParentSpanID: "session-task-turn",
		StartTime:    t0.Add(10 * time.Millisecond),
		EndTime:      t0.Add(950 * time.Millisecond),
		Duration:     940 * time.Millisecond,
	}

	base := &TraceData{
		TraceID:   "codex",
		Spans:     []*SpanData{shortRoot},
		RootSpan:  shortRoot,
		SpanCount: 1,
		StartTime: shortRoot.StartTime,
		Duration:  shortRoot.Duration,
	}
	incoming := &TraceData{
		TraceID:   "codex",
		Spans:     []*SpanData{longRoot, childOfLongRoot},
		RootSpan:  longRoot,
		SpanCount: 2,
		StartTime: longRoot.StartTime,
		Duration:  longRoot.Duration,
	}

	base.Merge(incoming)

	if base.SpanCount != 3 {
		t.Fatalf("SpanCount = %d, want 3", base.SpanCount)
	}
	if base.RootSpan == nil || base.RootSpan.SpanID != longRoot.SpanID {
		t.Errorf("RootSpan = %+v, want longest parentless span %q", base.RootSpan, longRoot.SpanID)
	}
	if want := 950 * time.Millisecond; base.Duration != want {
		t.Errorf("Duration = %v, want %v (full trace range)", base.Duration, want)
	}
	if !base.StartTime.Equal(t0) {
		t.Errorf("StartTime = %v, want %v", base.StartTime, t0)
	}
}

func TestTraceData_Merge_IsIdempotentOnRepeatedCalls(t *testing.T) {
	t0 := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	base := &TraceData{
		TraceID: "abc",
		Spans: []*SpanData{
			{SpanID: "a", StartTime: t0},
		},
		SpanCount: 1,
		StartTime: t0,
	}
	incoming := &TraceData{
		TraceID: "abc",
		Spans: []*SpanData{
			{SpanID: "a", StartTime: t0},
			{SpanID: "b", StartTime: t0},
		},
		StartTime: t0,
	}

	base.Merge(incoming)
	base.Merge(incoming) // repeated merge should not duplicate span b

	if len(base.Spans) != 2 {
		t.Fatalf("expected 2 spans after repeated merge, got %d", len(base.Spans))
	}
	if base.SpanCount != 2 {
		t.Errorf("SpanCount = %d, want 2", base.SpanCount)
	}
}

// TestConvertTraces_MultiRoot verifies that a Codex-style trace with a short
// turn/start root and a long session_task.turn root reports the full trace
// range for Duration and picks the longest parentless span as RootSpan.
func TestConvertTraces_MultiRoot(t *testing.T) {
	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "codex")
	ss := rs.ScopeSpans().AppendEmpty()

	traceID := pcommon.TraceID([16]byte{0xC0, 0xDE})
	base := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)

	shortRoot := ss.Spans().AppendEmpty()
	shortRoot.SetTraceID(traceID)
	shortRoot.SetSpanID(pcommon.SpanID([8]byte{0x01}))
	shortRoot.SetName("turn/start")
	shortRoot.SetStartTimestamp(pcommon.NewTimestampFromTime(base))
	shortRoot.SetEndTimestamp(pcommon.NewTimestampFromTime(base.Add(2 * time.Millisecond)))

	longRoot := ss.Spans().AppendEmpty()
	longRoot.SetTraceID(traceID)
	longRoot.SetSpanID(pcommon.SpanID([8]byte{0x02}))
	longRoot.SetName("session_task.turn")
	longRoot.SetStartTimestamp(pcommon.NewTimestampFromTime(base.Add(1 * time.Millisecond)))
	longRoot.SetEndTimestamp(pcommon.NewTimestampFromTime(base.Add(800 * time.Millisecond)))

	child := ss.Spans().AppendEmpty()
	child.SetTraceID(traceID)
	child.SetSpanID(pcommon.SpanID([8]byte{0x03}))
	child.SetParentSpanID(pcommon.SpanID([8]byte{0x02}))
	child.SetName("receiving_stream")
	child.SetStartTimestamp(pcommon.NewTimestampFromTime(base.Add(50 * time.Millisecond)))
	child.SetEndTimestamp(pcommon.NewTimestampFromTime(base.Add(950 * time.Millisecond)))

	traces := ConvertTraces(td)
	if len(traces) != 1 {
		t.Fatalf("ConvertTraces returned %d traces, want 1", len(traces))
	}
	got := traces[0]

	if got.SpanCount != 3 {
		t.Errorf("SpanCount = %d, want 3", got.SpanCount)
	}
	if got.RootSpan == nil {
		t.Fatalf("RootSpan is nil")
	}
	if got.RootSpan.Name != "session_task.turn" {
		t.Errorf("RootSpan.Name = %q, want session_task.turn (longest parentless span)", got.RootSpan.Name)
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

// TestConvertTraces_OrphanSpansOnly covers the fully disconnected case:
// every span has a ParentSpanID but none of them match a span in the same
// trace. Duration still comes from the full range and ServiceName falls
// back to the first seen span's service.
func TestConvertTraces_OrphanSpansOnly(t *testing.T) {
	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "codex")
	ss := rs.ScopeSpans().AppendEmpty()

	traceID := pcommon.TraceID([16]byte{0xAB})
	base := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)

	a := ss.Spans().AppendEmpty()
	a.SetTraceID(traceID)
	a.SetSpanID(pcommon.SpanID([8]byte{0x0A}))
	a.SetParentSpanID(pcommon.SpanID([8]byte{0xFF}))
	a.SetName("orphan-a")
	a.SetStartTimestamp(pcommon.NewTimestampFromTime(base))
	a.SetEndTimestamp(pcommon.NewTimestampFromTime(base.Add(30 * time.Millisecond)))

	b := ss.Spans().AppendEmpty()
	b.SetTraceID(traceID)
	b.SetSpanID(pcommon.SpanID([8]byte{0x0B}))
	b.SetParentSpanID(pcommon.SpanID([8]byte{0xEE}))
	b.SetName("orphan-b")
	b.SetStartTimestamp(pcommon.NewTimestampFromTime(base.Add(5 * time.Millisecond)))
	b.SetEndTimestamp(pcommon.NewTimestampFromTime(base.Add(100 * time.Millisecond)))

	traces := ConvertTraces(td)
	if len(traces) != 1 {
		t.Fatalf("ConvertTraces returned %d traces, want 1", len(traces))
	}
	got := traces[0]

	if got.RootSpan != nil {
		t.Errorf("RootSpan = %+v, want nil (no parentless spans)", got.RootSpan)
	}
	if want := 100 * time.Millisecond; got.Duration != want {
		t.Errorf("Duration = %v, want %v", got.Duration, want)
	}
	if got.ServiceName != "codex" {
		t.Errorf("ServiceName = %q, want codex", got.ServiceName)
	}
}

// TestConvertTraces_RootlessMultiServiceUsesEarliestStart ensures that when a
// rootless trace spans multiple services, ConvertTraces labels it by the
// earliest-started span's service rather than by resource iteration order.
func TestConvertTraces_RootlessMultiServiceUsesEarliestStart(t *testing.T) {
	td := ptrace.NewTraces()
	traceID := pcommon.TraceID([16]byte{0xCD})
	base := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)

	// First resource batch (iteration order 0) is a later-started service.
	rsLate := td.ResourceSpans().AppendEmpty()
	rsLate.Resource().Attributes().PutStr("service.name", "late-service")
	late := rsLate.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	late.SetTraceID(traceID)
	late.SetSpanID(pcommon.SpanID([8]byte{0x01}))
	late.SetParentSpanID(pcommon.SpanID([8]byte{0xAA}))
	late.SetName("late-span")
	late.SetStartTimestamp(pcommon.NewTimestampFromTime(base.Add(20 * time.Millisecond)))
	late.SetEndTimestamp(pcommon.NewTimestampFromTime(base.Add(40 * time.Millisecond)))

	// Second resource batch (iteration order 1) started earlier in wall time.
	rsEarly := td.ResourceSpans().AppendEmpty()
	rsEarly.Resource().Attributes().PutStr("service.name", "early-service")
	early := rsEarly.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	early.SetTraceID(traceID)
	early.SetSpanID(pcommon.SpanID([8]byte{0x02}))
	early.SetParentSpanID(pcommon.SpanID([8]byte{0xBB}))
	early.SetName("early-span")
	early.SetStartTimestamp(pcommon.NewTimestampFromTime(base))
	early.SetEndTimestamp(pcommon.NewTimestampFromTime(base.Add(10 * time.Millisecond)))

	traces := ConvertTraces(td)
	if len(traces) != 1 {
		t.Fatalf("ConvertTraces returned %d traces, want 1", len(traces))
	}
	got := traces[0]

	if got.RootSpan != nil {
		t.Errorf("RootSpan = %+v, want nil (no parentless spans)", got.RootSpan)
	}
	if got.ServiceName != "early-service" {
		t.Errorf("ServiceName = %q, want early-service (earliest start)", got.ServiceName)
	}
}
