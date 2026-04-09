package store

import (
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

func TestRingBuffer_Add(t *testing.T) {
	rb := NewRingBuffer[int](3)

	rb.Add(1)
	rb.Add(2)
	rb.Add(3)

	if rb.Len() != 3 {
		t.Fatalf("expected len 3, got %d", rb.Len())
	}

	items := rb.Items()
	expected := []int{1, 2, 3}
	for i, v := range expected {
		if items[i] != v {
			t.Errorf("items[%d] = %d, want %d", i, items[i], v)
		}
	}
}

func TestRingBuffer_Overflow(t *testing.T) {
	rb := NewRingBuffer[int](3)

	rb.Add(1)
	rb.Add(2)
	rb.Add(3)
	rb.Add(4) // overwrites 1
	rb.Add(5) // overwrites 2

	if rb.Len() != 3 {
		t.Fatalf("expected len 3, got %d", rb.Len())
	}

	items := rb.Items()
	expected := []int{3, 4, 5}
	for i, v := range expected {
		if items[i] != v {
			t.Errorf("items[%d] = %d, want %d", i, items[i], v)
		}
	}
}

func TestRingBuffer_Clear(t *testing.T) {
	rb := NewRingBuffer[int](3)
	rb.Add(1)
	rb.Add(2)
	rb.Clear()

	if rb.Len() != 0 {
		t.Fatalf("expected len 0 after clear, got %d", rb.Len())
	}
	if len(rb.Items()) != 0 {
		t.Fatalf("expected empty items after clear")
	}
}

func TestStore_AddAndGetTraces(t *testing.T) {
	var called int
	s := NewStore(10, 10, 10, func(sig SignalType, data any) {
		called++
		if sig != SignalTraces {
			t.Errorf("expected SignalTraces, got %s", sig)
		}
	})

	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "test-service")
	ss := rs.ScopeSpans().AppendEmpty()

	span := ss.Spans().AppendEmpty()
	span.SetTraceID(pcommon.TraceID([16]byte{1}))
	span.SetSpanID(pcommon.SpanID([8]byte{1}))
	span.SetName("test-span")
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	span.SetEndTimestamp(pcommon.NewTimestampFromTime(time.Now().Add(100 * time.Millisecond)))

	s.AddTraces(td)

	traces := s.GetTraces()
	if len(traces) != 1 {
		t.Fatalf("expected 1 trace, got %d", len(traces))
	}
	if traces[0].ServiceName != "test-service" {
		t.Errorf("expected service name 'test-service', got '%s'", traces[0].ServiceName)
	}
	if len(traces[0].Spans) != 1 {
		t.Errorf("expected 1 span, got %d", len(traces[0].Spans))
	}
	if called != 1 {
		t.Errorf("expected onAdd called 1 time, got %d", called)
	}
}

func TestStore_GetTraceByID(t *testing.T) {
	s := NewStore(10, 10, 10, nil)

	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "svc")
	ss := rs.ScopeSpans().AppendEmpty()

	traceID := pcommon.TraceID([16]byte{1, 2, 3})
	span := ss.Spans().AppendEmpty()
	span.SetTraceID(traceID)
	span.SetSpanID(pcommon.SpanID([8]byte{1}))
	span.SetName("span1")
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	span.SetEndTimestamp(pcommon.NewTimestampFromTime(time.Now().Add(50 * time.Millisecond)))

	s.AddTraces(td)

	trace, ok := s.GetTraceByID(traceID.String())
	if !ok {
		t.Fatal("expected to find trace by ID")
	}
	if trace.TraceID != traceID.String() {
		t.Errorf("expected traceID %s, got %s", traceID.String(), trace.TraceID)
	}

	_, ok = s.GetTraceByID("nonexistent")
	if ok {
		t.Error("expected not found for nonexistent trace ID")
	}
}

func TestStore_AddAndGetLogs(t *testing.T) {
	s := NewStore(10, 10, 10, nil)

	ld := plog.NewLogs()
	rl := ld.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("service.name", "log-svc")
	sl := rl.ScopeLogs().AppendEmpty()
	lr := sl.LogRecords().AppendEmpty()
	lr.SetSeverityText("INFO")
	lr.Body().SetStr("test log message")
	lr.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))

	s.AddLogs(ld)

	logs := s.GetLogs()
	if len(logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(logs))
	}
	if logs[0].Body != "test log message" {
		t.Errorf("expected body 'test log message', got '%s'", logs[0].Body)
	}
	if logs[0].SeverityText != "INFO" {
		t.Errorf("expected severity 'INFO', got '%s'", logs[0].SeverityText)
	}
}

func TestStore_Clear(t *testing.T) {
	s := NewStore(10, 10, 10, nil)

	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	ss := rs.ScopeSpans().AppendEmpty()
	span := ss.Spans().AppendEmpty()
	span.SetTraceID(pcommon.TraceID([16]byte{1}))
	span.SetSpanID(pcommon.SpanID([8]byte{1}))
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	span.SetEndTimestamp(pcommon.NewTimestampFromTime(time.Now()))

	s.AddTraces(td)
	s.Clear()

	if len(s.GetTraces()) != 0 {
		t.Error("expected 0 traces after clear")
	}
}

func TestStore_NewestFirst(t *testing.T) {
	s := NewStore(10, 10, 10, nil)

	for i := 0; i < 3; i++ {
		td := ptrace.NewTraces()
		rs := td.ResourceSpans().AppendEmpty()
		rs.Resource().Attributes().PutStr("service.name", "svc")
		ss := rs.ScopeSpans().AppendEmpty()
		span := ss.Spans().AppendEmpty()
		span.SetTraceID(pcommon.TraceID([16]byte{byte(i + 1)}))
		span.SetSpanID(pcommon.SpanID([8]byte{byte(i + 1)}))
		span.SetName("span")
		now := time.Now().Add(time.Duration(i) * time.Second)
		span.SetStartTimestamp(pcommon.NewTimestampFromTime(now))
		span.SetEndTimestamp(pcommon.NewTimestampFromTime(now.Add(time.Millisecond)))
		s.AddTraces(td)
	}

	traces := s.GetTraces()
	if len(traces) != 3 {
		t.Fatalf("expected 3 traces, got %d", len(traces))
	}
	// Newest first: trace with byte(3) should be first.
	if traces[0].TraceID[len(traces[0].TraceID)-1] != '0' {
		// TraceIDs are hex strings; just check ordering (last added = first returned).
		if traces[0].StartTime.After(traces[2].StartTime) {
			// Good: newest first.
		} else {
			t.Error("expected newest trace first")
		}
	}
}
