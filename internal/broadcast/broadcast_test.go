package broadcast

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"

	"github.com/mashiro/otelop/internal/storage"
)

// captured collects every payload broadcast during a test, keyed by signal
// type, so assertions can inspect the exact JSON the WebSocket hub would
// have sent to the frontend.
type captured struct {
	mu      sync.Mutex
	traces  []*TraceData
	metrics []*MetricData
	logs    []*LogData
}

func (c *captured) onAdd(_ context.Context, signalType SignalType, data any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	switch signalType {
	case SignalTraces:
		c.traces = append(c.traces, data.(*TraceData))
	case SignalMetrics:
		c.metrics = append(c.metrics, data.(*MetricData))
	case SignalLogs:
		c.logs = append(c.logs, data.(*LogData))
	}
}

func openTestStorage(t *testing.T, rec *captured) *storage.Storage {
	t.Helper()
	var s *storage.Storage
	s, err := storage.Open(context.Background(), storage.Options{
		OnCommit: func(ctx context.Context, ev storage.CommitEvent) {
			New(s, rec.onAdd)(ctx, ev)
		},
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// keySet returns the set of top-level JSON keys of v, for shape comparisons
// that don't pin down every value (per the task: "golden-ish assertions on
// key sets and representative values, not brittle full-string equality").
func keySet(t *testing.T, v any) map[string]bool {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal into map: %v\nraw=%s", err, raw)
	}
	out := make(map[string]bool, len(m))
	for k := range m {
		out[k] = true
	}
	return out
}

func requireKeys(t *testing.T, got map[string]bool, want ...string) {
	t.Helper()
	for _, k := range want {
		if !got[k] {
			t.Errorf("missing expected JSON key %q (got keys: %v)", k, got)
		}
	}
}

// requireExactKeys is stricter than requireKeys: with the old store package deleted,
// these tests are the only thing pinning the wire shape to
// frontend/src/types/telemetry.ts, so a stray extra field (or a dropped
// omitempty) must fail loudly instead of only being caught by presence checks.
func requireExactKeys(t *testing.T, got map[string]bool, want ...string) {
	t.Helper()
	requireKeys(t, got, want...)
	if len(got) != len(want) {
		t.Errorf("unexpected JSON keys: got %v, want exactly %v", got, want)
	}
}

func TestBroadcast_Traces_WireShapeMatchesFrontendContract(t *testing.T) {
	rec := &captured{}
	s := openTestStorage(t, rec)

	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "svc-a")
	ss := rs.ScopeSpans().AppendEmpty()
	sp := ss.Spans().AppendEmpty()
	sp.SetTraceID(pcommon.TraceID([16]byte{1}))
	sp.SetSpanID(pcommon.SpanID([8]byte{1}))
	sp.SetName("root")
	sp.SetStartTimestamp(pcommon.NewTimestampFromTime(start))
	sp.SetEndTimestamp(pcommon.NewTimestampFromTime(start.Add(5 * time.Millisecond)))
	sp.Status().SetCode(ptrace.StatusCodeOk)

	s.AddTraces(context.Background(), td)
	s.Sync()

	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.traces) != 1 {
		t.Fatalf("traces broadcast = %d, want 1", len(rec.traces))
	}
	trace := rec.traces[0]

	keys := keySet(t, trace)
	requireExactKeys(t, keys, "traceId", "rootSpan", "spans", "serviceName", "spanCount", "startTime", "duration", "hasError")

	if trace.TraceID != pcommon.TraceID([16]byte{1}).String() {
		t.Errorf("traceId = %v", trace.TraceID)
	}
	if trace.ServiceName != "svc-a" {
		t.Errorf("serviceName = %v, want svc-a", trace.ServiceName)
	}
	if trace.SpanCount != 1 {
		t.Errorf("spanCount = %v, want 1", trace.SpanCount)
	}
	if trace.Duration != 5*time.Millisecond {
		t.Errorf("duration = %v, want 5ms", trace.Duration)
	}
	if trace.RootSpan == nil || trace.RootSpan.Name != "root" {
		t.Fatalf("rootSpan = %+v, want span named root", trace.RootSpan)
	}
	spanKeys := keySet(t, trace.Spans[0])
	requireExactKeys(t, spanKeys, "traceId", "spanId", "parentSpanId", "name", "kind", "serviceName",
		"startTime", "endTime", "duration", "statusCode", "statusMessage", "attributes", "events", "resource")

	// duration must marshal as a bare integer of nanoseconds (time.Duration's
	// default encoding), matching frontend/src/types/telemetry.ts's `duration: number`.
	raw, _ := json.Marshal(trace)
	var generic map[string]any
	_ = json.Unmarshal(raw, &generic)
	if _, ok := generic["duration"].(float64); !ok {
		t.Errorf("duration did not marshal as a JSON number: %T", generic["duration"])
	}
}

func TestBroadcast_Metrics_WireShapeAndBaselineOmission(t *testing.T) {
	rec := &captured{}
	s := openTestStorage(t, rec)

	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	// First scrape of a cumulative monotonic sum: a pure baseline. Old
	// store never broadcast this; the new pipeline must also drop it.
	md1 := pmetric.NewMetrics()
	rm1 := md1.ResourceMetrics().AppendEmpty()
	rm1.Resource().Attributes().PutStr("service.name", "svc-a")
	rm1.Resource().Attributes().PutStr("deployment.environment", "dev")
	sm1 := rm1.ScopeMetrics().AppendEmpty()
	m1 := sm1.Metrics().AppendEmpty()
	m1.SetName("requests.total")
	m1.SetUnit("1")
	sum1 := m1.SetEmptySum()
	sum1.SetIsMonotonic(true)
	sum1.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	dp1 := sum1.DataPoints().AppendEmpty()
	dp1.SetDoubleValue(100)
	dp1.SetTimestamp(pcommon.NewTimestampFromTime(start))
	s.AddMetrics(context.Background(), md1)
	s.Sync()

	rec.mu.Lock()
	if len(rec.metrics) != 0 {
		t.Fatalf("baseline scrape broadcast %d metrics, want 0 (baseline omitted)", len(rec.metrics))
	}
	rec.mu.Unlock()

	// Second scrape: now there's a predecessor, so a real delta is derived
	// and must be broadcast.
	md2 := pmetric.NewMetrics()
	rm2 := md2.ResourceMetrics().AppendEmpty()
	rm2.Resource().Attributes().PutStr("service.name", "svc-a")
	rm2.Resource().Attributes().PutStr("deployment.environment", "dev")
	sm2 := rm2.ScopeMetrics().AppendEmpty()
	m2 := sm2.Metrics().AppendEmpty()
	m2.SetName("requests.total")
	m2.SetUnit("1")
	sum2 := m2.SetEmptySum()
	sum2.SetIsMonotonic(true)
	sum2.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	dp2 := sum2.DataPoints().AppendEmpty()
	dp2.SetDoubleValue(140)
	// The predecessor is deliberately more than an hour old. Broadcast must
	// fetch the actual previous observation instead of using a fixed lookback.
	dp2.SetTimestamp(pcommon.NewTimestampFromTime(start.Add(2 * time.Hour)))
	s.AddMetrics(context.Background(), md2)
	s.Sync()

	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.metrics) != 1 {
		t.Fatalf("second scrape broadcast %d metrics, want 1", len(rec.metrics))
	}
	metric := rec.metrics[0]
	keys := keySet(t, metric)
	requireExactKeys(t, keys, "name", "description", "unit", "type", "serviceName", "resource", "dataPoints", "receivedAt")
	if metric.Name != "requests.total" {
		t.Errorf("name = %v", metric.Name)
	}
	if metric.ServiceName != "svc-a" {
		t.Errorf("serviceName = %v", metric.ServiceName)
	}
	// The broadcast must carry the full resource attribute map of the
	// batch's resource, not an empty placeholder.
	if metric.Resource["service.name"] != "svc-a" || metric.Resource["deployment.environment"] != "dev" {
		t.Errorf("resource = %v, want full resource attributes", metric.Resource)
	}
	if len(metric.DataPoints) != 1 {
		t.Fatalf("dataPoints = %d, want 1 (only the new delta point)", len(metric.DataPoints))
	}
	dp := metric.DataPoints[0]
	dpKeys := keySet(t, dp)
	// Non-distribution Sum data point: count/sum/min/max must stay omitted
	// (omitempty), not present-as-null, matching telemetry.ts's optional fields.
	requireExactKeys(t, dpKeys, "id", "timestamp", "value", "cumulative", "attributes")
	if dp.Value != 40 {
		t.Errorf("value = %v, want 40 (140-100 delta)", dp.Value)
	}
	if dp.Cumulative == nil || *dp.Cumulative != 140 {
		t.Errorf("cumulative = %v, want 140", dp.Cumulative)
	}
	if dp.ID == "" {
		t.Errorf("id must be non-empty")
	}
}

func TestBroadcast_Logs_WireShapeMatchesFrontendContract(t *testing.T) {
	rec := &captured{}
	s := openTestStorage(t, rec)

	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	ld := plog.NewLogs()
	rl := ld.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("service.name", "svc-a")
	sl := rl.ScopeLogs().AppendEmpty()
	lr := sl.LogRecords().AppendEmpty()
	lr.SetTimestamp(pcommon.NewTimestampFromTime(start))
	lr.SetTraceID(pcommon.TraceID([16]byte{7}))
	lr.Body().SetStr("hello")
	lr.SetSeverityText("INFO")
	lr.SetSeverityNumber(9)

	s.AddLogs(context.Background(), ld)
	s.Sync()

	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.logs) != 1 {
		t.Fatalf("logs broadcast = %d, want 1", len(rec.logs))
	}
	log := rec.logs[0]
	keys := keySet(t, log)
	requireExactKeys(t, keys, "id", "timestamp", "observedTimestamp", "traceId", "spanId",
		"severityNumber", "severityText", "body", "serviceName", "attributes", "resource")
	if log.Body != "hello" {
		t.Errorf("body = %v", log.Body)
	}
	if log.ServiceName != "svc-a" {
		t.Errorf("serviceName = %v, want svc-a", log.ServiceName)
	}
	if log.TraceID != pcommon.TraceID([16]byte{7}).String() {
		t.Errorf("traceId = %v", log.TraceID)
	}
	if log.ID == "" {
		t.Errorf("id must be non-empty")
	}
}
