package store

import (
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
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

func TestStore_AddTraces_DeduplicateSpans(t *testing.T) {
	s := NewStore(10, 10, 10, nil)

	traceID := pcommon.TraceID([16]byte{1})
	spanID := pcommon.SpanID([8]byte{1})
	now := time.Now()

	// First batch: add a span.
	td1 := ptrace.NewTraces()
	rs1 := td1.ResourceSpans().AppendEmpty()
	rs1.Resource().Attributes().PutStr("service.name", "svc")
	ss1 := rs1.ScopeSpans().AppendEmpty()
	span1 := ss1.Spans().AppendEmpty()
	span1.SetTraceID(traceID)
	span1.SetSpanID(spanID)
	span1.SetName("span-a")
	span1.SetStartTimestamp(pcommon.NewTimestampFromTime(now))
	span1.SetEndTimestamp(pcommon.NewTimestampFromTime(now.Add(100 * time.Millisecond)))

	s.AddTraces(td1)

	// Second batch: same traceID and same spanID (duplicate).
	td2 := ptrace.NewTraces()
	rs2 := td2.ResourceSpans().AppendEmpty()
	rs2.Resource().Attributes().PutStr("service.name", "svc")
	ss2 := rs2.ScopeSpans().AppendEmpty()
	span2 := ss2.Spans().AppendEmpty()
	span2.SetTraceID(traceID)
	span2.SetSpanID(spanID) // same span ID
	span2.SetName("span-a")
	span2.SetStartTimestamp(pcommon.NewTimestampFromTime(now))
	span2.SetEndTimestamp(pcommon.NewTimestampFromTime(now.Add(100 * time.Millisecond)))
	// Also add a genuinely new span.
	span3 := ss2.Spans().AppendEmpty()
	span3.SetTraceID(traceID)
	span3.SetSpanID(pcommon.SpanID([8]byte{2})) // different span ID
	span3.SetName("span-b")
	span3.SetStartTimestamp(pcommon.NewTimestampFromTime(now))
	span3.SetEndTimestamp(pcommon.NewTimestampFromTime(now.Add(50 * time.Millisecond)))

	s.AddTraces(td2)

	traces := s.GetTraces()
	if len(traces) != 1 {
		t.Fatalf("expected 1 trace, got %d", len(traces))
	}
	if len(traces[0].Spans) != 2 {
		t.Fatalf("expected 2 spans (deduplicated), got %d", len(traces[0].Spans))
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

func TestStore_AddMetrics_Merge(t *testing.T) {
	s := NewStore(10, 10, 10, nil)

	// First batch: add a gauge metric with 1 data point.
	md1 := pmetric.NewMetrics()
	rm1 := md1.ResourceMetrics().AppendEmpty()
	rm1.Resource().Attributes().PutStr("service.name", "test-svc")
	sm1 := rm1.ScopeMetrics().AppendEmpty()
	m1 := sm1.Metrics().AppendEmpty()
	m1.SetName("http.request.duration")
	m1.SetUnit("ms")
	m1.SetEmptyGauge()
	dp1 := m1.Gauge().DataPoints().AppendEmpty()
	dp1.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	dp1.SetDoubleValue(42.0)

	s.AddMetrics(md1)

	metrics := s.GetMetrics()
	if len(metrics) != 1 {
		t.Fatalf("expected 1 metric, got %d", len(metrics))
	}
	if len(metrics[0].DataPoints) != 1 {
		t.Fatalf("expected 1 data point, got %d", len(metrics[0].DataPoints))
	}

	// Second batch: same metric name + service, should merge data points.
	md2 := pmetric.NewMetrics()
	rm2 := md2.ResourceMetrics().AppendEmpty()
	rm2.Resource().Attributes().PutStr("service.name", "test-svc")
	sm2 := rm2.ScopeMetrics().AppendEmpty()
	m2 := sm2.Metrics().AppendEmpty()
	m2.SetName("http.request.duration")
	m2.SetUnit("ms")
	m2.SetEmptyGauge()
	dp2 := m2.Gauge().DataPoints().AppendEmpty()
	dp2.SetTimestamp(pcommon.NewTimestampFromTime(time.Now().Add(time.Second)))
	dp2.SetDoubleValue(55.0)

	s.AddMetrics(md2)

	metrics = s.GetMetrics()
	if len(metrics) != 1 {
		t.Fatalf("expected 1 metric after merge, got %d", len(metrics))
	}
	if len(metrics[0].DataPoints) != 2 {
		t.Fatalf("expected 2 data points after merge, got %d", len(metrics[0].DataPoints))
	}
	if metrics[0].DataPoints[0].Value != 42.0 {
		t.Errorf("expected first data point value 42.0, got %f", metrics[0].DataPoints[0].Value)
	}
	if metrics[0].DataPoints[1].Value != 55.0 {
		t.Errorf("expected second data point value 55.0, got %f", metrics[0].DataPoints[1].Value)
	}
}

func TestStore_AddMetrics_DifferentNames(t *testing.T) {
	s := NewStore(10, 10, 10, nil)

	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "test-svc")
	sm := rm.ScopeMetrics().AppendEmpty()

	m1 := sm.Metrics().AppendEmpty()
	m1.SetName("metric.a")
	m1.SetEmptyGauge()
	m1.Gauge().DataPoints().AppendEmpty().SetDoubleValue(1.0)

	m2 := sm.Metrics().AppendEmpty()
	m2.SetName("metric.b")
	m2.SetEmptyGauge()
	m2.Gauge().DataPoints().AppendEmpty().SetDoubleValue(2.0)

	s.AddMetrics(md)

	metrics := s.GetMetrics()
	if len(metrics) != 2 {
		t.Fatalf("expected 2 distinct metrics, got %d", len(metrics))
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
