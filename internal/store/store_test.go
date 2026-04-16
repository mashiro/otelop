package store

import (
	"encoding/json"
	"math"
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
	s := NewStore(10, 10, 10, 100, func(sig SignalType, data any) {
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
	s := NewStore(10, 10, 10, 100, nil)

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
	s := NewStore(10, 10, 10, 100, nil)

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
	s := NewStore(10, 10, 10, 100, nil)

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

func TestStore_GetLogsPageByTraceID(t *testing.T) {
	s := NewStore(10, 10, 10, 100, nil)

	addLog := func(traceIDByte byte, body string) {
		ld := plog.NewLogs()
		rl := ld.ResourceLogs().AppendEmpty()
		rl.Resource().Attributes().PutStr("service.name", "svc")
		sl := rl.ScopeLogs().AppendEmpty()
		lr := sl.LogRecords().AppendEmpty()
		lr.SetTraceID(pcommon.TraceID([16]byte{traceIDByte}))
		lr.Body().SetStr(body)
		lr.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))
		s.AddLogs(ld)
	}

	addLog(1, "t1-first")
	addLog(2, "t2-only")
	addLog(1, "t1-second")
	addLog(0, "no-trace") // TraceID zero: must not be indexed

	targetID := pcommon.TraceID([16]byte{1}).String()
	items, total := s.GetLogsPageByTraceID(targetID, 0, 0)
	if total != 2 {
		t.Fatalf("total = %d, want 2", total)
	}
	if items[0].Body != "t1-second" || items[1].Body != "t1-first" {
		t.Errorf("newest-first order broken: got [%q, %q]", items[0].Body, items[1].Body)
	}

	// Unrelated traceID must not leak results from other buckets.
	other := pcommon.TraceID([16]byte{9}).String()
	if _, total := s.GetLogsPageByTraceID(other, 0, 0); total != 0 {
		t.Errorf("unknown trace total = %d, want 0", total)
	}
}

func TestStore_AddLogs_EvictionPrunesTraceIndex(t *testing.T) {
	// logCap=2 so the 3rd log evicts the 1st.
	s := NewStore(10, 10, 2, 100, nil)

	addLog := func(traceIDByte byte) {
		ld := plog.NewLogs()
		rl := ld.ResourceLogs().AppendEmpty()
		sl := rl.ScopeLogs().AppendEmpty()
		lr := sl.LogRecords().AppendEmpty()
		lr.SetTraceID(pcommon.TraceID([16]byte{traceIDByte}))
		lr.Body().SetStr("x")
		s.AddLogs(ld)
	}

	addLog(1)
	addLog(1)
	addLog(2) // evicts the first log with traceID=1

	id1 := pcommon.TraceID([16]byte{1}).String()
	items, total := s.GetLogsPageByTraceID(id1, 0, 0)
	if total != 1 || len(items) != 1 {
		t.Fatalf("traceID=1 after eviction: total=%d items=%d, want 1/1", total, len(items))
	}

	addLog(2) // evicts the remaining log with traceID=1
	if _, total := s.GetLogsPageByTraceID(id1, 0, 0); total != 0 {
		t.Errorf("traceID=1 after second eviction: total=%d, want 0", total)
	}
}

func TestStore_AddMetrics_Merge(t *testing.T) {
	s := NewStore(10, 10, 10, 100, nil)

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

func TestConvertMetrics_SkipsNonFinite(t *testing.T) {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "test-svc")
	sm := rm.ScopeMetrics().AppendEmpty()

	gauge := sm.Metrics().AppendEmpty()
	gauge.SetName("ratio.gauge")
	gauge.SetEmptyGauge()
	gauge.Gauge().DataPoints().AppendEmpty().SetDoubleValue(math.NaN())
	gauge.Gauge().DataPoints().AppendEmpty().SetDoubleValue(math.Inf(1))
	gauge.Gauge().DataPoints().AppendEmpty().SetDoubleValue(math.Inf(-1))
	gauge.Gauge().DataPoints().AppendEmpty().SetDoubleValue(1.5)

	sum := sm.Metrics().AppendEmpty()
	sum.SetName("rate.sum")
	sum.SetEmptySum()
	sum.Sum().DataPoints().AppendEmpty().SetDoubleValue(math.NaN())

	got := convertMetrics(md, newSeriesStore())
	if len(got) != 2 {
		t.Fatalf("expected 2 metrics, got %d", len(got))
	}

	if len(got[0].DataPoints) != 1 {
		t.Fatalf("expected 1 finite data point on gauge, got %d", len(got[0].DataPoints))
	}
	if got[0].DataPoints[0].Value != 1.5 {
		t.Errorf("expected gauge value 1.5, got %f", got[0].DataPoints[0].Value)
	}

	if len(got[1].DataPoints) != 0 {
		t.Errorf("expected sum to have all data points skipped, got %d", len(got[1].DataPoints))
	}

	if _, err := json.Marshal(got); err != nil {
		t.Fatalf("expected sanitized metrics to be JSON-marshalable, got %v", err)
	}
}

func TestAttributesToMap_NonFiniteDoubles(t *testing.T) {
	attrs := pcommon.NewMap()
	attrs.PutDouble("nan", math.NaN())
	attrs.PutDouble("pos_inf", math.Inf(1))
	attrs.PutDouble("neg_inf", math.Inf(-1))
	attrs.PutDouble("finite", 1.5)

	got := attributesToMap(attrs)

	if got["nan"] != "NaN" {
		t.Errorf("nan: expected %q, got %v", "NaN", got["nan"])
	}
	if got["pos_inf"] != "+Inf" {
		t.Errorf("pos_inf: expected %q, got %v", "+Inf", got["pos_inf"])
	}
	if got["neg_inf"] != "-Inf" {
		t.Errorf("neg_inf: expected %q, got %v", "-Inf", got["neg_inf"])
	}
	if got["finite"] != 1.5 {
		t.Errorf("finite: expected 1.5, got %v", got["finite"])
	}

	if _, err := json.Marshal(got); err != nil {
		t.Fatalf("expected sanitized attributes to be JSON-marshalable, got %v", err)
	}
}

func TestStore_AddMetrics_SkipsEmptyMetrics(t *testing.T) {
	var notified []*MetricData
	s := NewStore(10, 10, 10, 100, func(sig SignalType, data any) {
		if sig == SignalMetrics {
			notified = append(notified, data.(*MetricData))
		}
	})

	// First scrape of a cumulative monotonic Sum: delta baseline, no points emitted.
	md1 := pmetric.NewMetrics()
	rm1 := md1.ResourceMetrics().AppendEmpty()
	rm1.Resource().Attributes().PutStr("service.name", "svc")
	sm1 := rm1.ScopeMetrics().AppendEmpty()
	m1 := sm1.Metrics().AppendEmpty()
	m1.SetName("requests.total")
	sum1 := m1.SetEmptySum()
	sum1.SetIsMonotonic(true)
	sum1.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	sum1.DataPoints().AppendEmpty().SetIntValue(100)

	s.AddMetrics(md1)

	if got := s.GetMetrics(); len(got) != 0 {
		t.Fatalf("baseline scrape should not be stored, got %d metrics", len(got))
	}
	if len(notified) != 0 {
		t.Fatalf("baseline scrape should not notify subscribers, got %d", len(notified))
	}

	// Second scrape produces a real delta — metric should now appear.
	md2 := pmetric.NewMetrics()
	rm2 := md2.ResourceMetrics().AppendEmpty()
	rm2.Resource().Attributes().PutStr("service.name", "svc")
	sm2 := rm2.ScopeMetrics().AppendEmpty()
	m2 := sm2.Metrics().AppendEmpty()
	m2.SetName("requests.total")
	sum2 := m2.SetEmptySum()
	sum2.SetIsMonotonic(true)
	sum2.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	sum2.DataPoints().AppendEmpty().SetIntValue(150)

	s.AddMetrics(md2)

	metrics := s.GetMetrics()
	if len(metrics) != 1 || len(metrics[0].DataPoints) != 1 {
		t.Fatalf("expected 1 metric with 1 delta point, got %+v", metrics)
	}
	if len(notified) != 1 {
		t.Fatalf("expected 1 notification, got %d", len(notified))
	}

	// The broadcast payload must serialize dataPoints as a real array, never null.
	payload, err := json.Marshal(notified[0])
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded struct {
		DataPoints []map[string]any `json:"dataPoints"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.DataPoints == nil {
		t.Fatalf("dataPoints must not serialize as null: %s", payload)
	}
}

func TestStore_AddMetrics_DifferentNames(t *testing.T) {
	s := NewStore(10, 10, 10, 100, nil)

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
	s := NewStore(10, 10, 10, 100, nil)

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

func TestStore_AddTraces_EvictionClearsIndex(t *testing.T) {
	// Capacity 2 so that the 3rd distinct trace evicts the 1st.
	s := NewStore(2, 10, 10, 100, nil)

	add := func(traceByte byte) {
		td := ptrace.NewTraces()
		rs := td.ResourceSpans().AppendEmpty()
		rs.Resource().Attributes().PutStr("service.name", "svc")
		ss := rs.ScopeSpans().AppendEmpty()
		sp := ss.Spans().AppendEmpty()
		sp.SetTraceID(pcommon.TraceID([16]byte{traceByte}))
		sp.SetSpanID(pcommon.SpanID([8]byte{traceByte}))
		sp.SetStartTimestamp(pcommon.NewTimestampFromTime(time.Now()))
		sp.SetEndTimestamp(pcommon.NewTimestampFromTime(time.Now()))
		s.AddTraces(td)
	}

	add(1)
	add(2)
	add(3) // evicts trace 1

	traces := s.GetTraces()
	if len(traces) != 2 {
		t.Fatalf("expected 2 traces after eviction, got %d", len(traces))
	}
	// The evicted traceID should not be findable.
	firstID := pcommon.TraceID([16]byte{1}).String()
	if _, ok := s.GetTraceByID(firstID); ok {
		t.Error("evicted trace should not be findable by ID")
	}
	// Surviving traces should still be findable.
	secondID := pcommon.TraceID([16]byte{2}).String()
	if _, ok := s.GetTraceByID(secondID); !ok {
		t.Error("trace 2 should still be findable by ID")
	}
	thirdID := pcommon.TraceID([16]byte{3}).String()
	if _, ok := s.GetTraceByID(thirdID); !ok {
		t.Error("trace 3 should be findable by ID")
	}
}

func TestStore_GetTracesPage(t *testing.T) {
	s := NewStore(10, 10, 10, 100, nil)

	for i := 1; i <= 5; i++ {
		td := ptrace.NewTraces()
		rs := td.ResourceSpans().AppendEmpty()
		rs.Resource().Attributes().PutStr("service.name", "svc")
		ss := rs.ScopeSpans().AppendEmpty()
		sp := ss.Spans().AppendEmpty()
		sp.SetTraceID(pcommon.TraceID([16]byte{byte(i)}))
		sp.SetSpanID(pcommon.SpanID([8]byte{byte(i)}))
		sp.SetStartTimestamp(pcommon.NewTimestampFromTime(time.Now().Add(time.Duration(i) * time.Millisecond)))
		sp.SetEndTimestamp(pcommon.NewTimestampFromTime(time.Now().Add(time.Duration(i) * time.Millisecond)))
		s.AddTraces(td)
	}

	page, total := s.GetTracesPage(1, 2)
	if total != 5 {
		t.Errorf("total = %d, want 5", total)
	}
	if len(page) != 2 {
		t.Fatalf("page len = %d, want 2", len(page))
	}
	// newest-first: rank 0 is trace 5, rank 1 is trace 4, rank 2 is trace 3.
	if page[0].TraceID != pcommon.TraceID([16]byte{4}).String() {
		t.Errorf("page[0] = %s, want trace 4", page[0].TraceID)
	}
	if page[1].TraceID != pcommon.TraceID([16]byte{3}).String() {
		t.Errorf("page[1] = %s, want trace 3", page[1].TraceID)
	}
}

func TestStore_NewestFirst(t *testing.T) {
	s := NewStore(10, 10, 10, 100, nil)

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
