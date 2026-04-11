package store

import (
	"testing"
	"time"
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
	if base.Duration != t1.Sub(t2) {
		t.Errorf("Duration = %v, want %v", base.Duration, t1.Sub(t2))
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
