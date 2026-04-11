package graphql_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"

	otelopgraphql "github.com/mashiro/otelop/internal/graphql"
	"github.com/mashiro/otelop/internal/store"
)

func seedStore(t *testing.T) *store.Store {
	t.Helper()
	s := store.NewStore(10, 10, 10, 100, nil)

	// Two traces, one with an error span.
	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "svc-a")
	ss := rs.ScopeSpans().AppendEmpty()

	now := time.Date(2026, 4, 11, 12, 0, 0, 0, time.UTC)

	// trace 1: ok
	sp1 := ss.Spans().AppendEmpty()
	sp1.SetTraceID(pcommon.TraceID([16]byte{1}))
	sp1.SetSpanID(pcommon.SpanID([8]byte{1}))
	sp1.SetName("root-1")
	sp1.SetStartTimestamp(pcommon.NewTimestampFromTime(now))
	sp1.SetEndTimestamp(pcommon.NewTimestampFromTime(now.Add(5 * time.Millisecond)))
	sp1.Status().SetCode(ptrace.StatusCodeOk)

	// trace 2: has error child
	sp2 := ss.Spans().AppendEmpty()
	sp2.SetTraceID(pcommon.TraceID([16]byte{2}))
	sp2.SetSpanID(pcommon.SpanID([8]byte{2}))
	sp2.SetName("root-2")
	sp2.SetStartTimestamp(pcommon.NewTimestampFromTime(now))
	sp2.SetEndTimestamp(pcommon.NewTimestampFromTime(now.Add(10 * time.Millisecond)))

	sp2child := ss.Spans().AppendEmpty()
	sp2child.SetTraceID(pcommon.TraceID([16]byte{2}))
	sp2child.SetSpanID(pcommon.SpanID([8]byte{3}))
	sp2child.SetParentSpanID(pcommon.SpanID([8]byte{2}))
	sp2child.SetName("db")
	sp2child.SetStartTimestamp(pcommon.NewTimestampFromTime(now.Add(time.Millisecond)))
	sp2child.SetEndTimestamp(pcommon.NewTimestampFromTime(now.Add(4 * time.Millisecond)))
	sp2child.Status().SetCode(ptrace.StatusCodeError)
	sp2child.Status().SetMessage("db down")

	s.AddTraces(td)

	// A metric
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc-a")
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName("cpu.usage")
	m.SetDescription("cpu percentage")
	m.SetUnit("1")
	g := m.SetEmptyGauge()
	for i := 0; i < 3; i++ {
		dp := g.DataPoints().AppendEmpty()
		dp.SetDoubleValue(float64(i) + 0.5)
		dp.SetTimestamp(pcommon.NewTimestampFromTime(now))
	}
	s.AddMetrics(md)

	// Logs: 1 correlated with trace 2, 1 orphan
	ld := plog.NewLogs()
	rl := ld.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("service.name", "svc-a")
	sl := rl.ScopeLogs().AppendEmpty()

	lr := sl.LogRecords().AppendEmpty()
	lr.Body().SetStr("db timeout")
	lr.SetTraceID(pcommon.TraceID([16]byte{2}))
	lr.SetTimestamp(pcommon.NewTimestampFromTime(now))
	lr.SetSeverityText("ERROR")
	lr.SetSeverityNumber(17)

	lr2 := sl.LogRecords().AppendEmpty()
	lr2.Body().SetStr("unrelated")
	lr2.SetTimestamp(pcommon.NewTimestampFromTime(now))

	s.AddLogs(ld)

	return s
}

func exec(t *testing.T, s *store.Store, query string, vars map[string]any) map[string]any {
	t.Helper()
	schema := otelopgraphql.MustNewSchema(s)
	resp := schema.Exec(context.Background(), query, "", vars)
	if len(resp.Errors) > 0 {
		t.Fatalf("graphql errors: %+v", resp.Errors)
	}
	var data map[string]any
	if err := json.Unmarshal(resp.Data, &data); err != nil {
		t.Fatalf("unmarshal data: %v\nraw=%s", err, resp.Data)
	}
	return data
}

func TestSchemaParses(t *testing.T) {
	// Panic here would mean the schema.graphql and resolver surface are out of sync.
	otelopgraphql.MustNewSchema(store.NewStore(1, 1, 1, 1, nil))
}

func TestConfig(t *testing.T) {
	s := seedStore(t)
	data := exec(t, s, `{ config { traceCap logCap traceCount logCount } }`, nil)
	cfg := data["config"].(map[string]any)
	if cfg["traceCap"].(float64) != 10 {
		t.Errorf("traceCap = %v, want 10", cfg["traceCap"])
	}
	if cfg["traceCount"].(float64) != 2 {
		t.Errorf("traceCount = %v, want 2", cfg["traceCount"])
	}
	if cfg["logCount"].(float64) != 2 {
		t.Errorf("logCount = %v, want 2", cfg["logCount"])
	}
}

func TestTraces_FieldSelection(t *testing.T) {
	s := seedStore(t)
	data := exec(t, s, `{ traces(limit: 10) { total items { traceId serviceName hasError spanCount durationMs } } }`, nil)
	conn := data["traces"].(map[string]any)
	if conn["total"].(float64) != 2 {
		t.Errorf("total = %v, want 2", conn["total"])
	}
	items := conn["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("items len = %d, want 2", len(items))
	}
	// Trace #2 (newest first) has the error span.
	var sawError bool
	for _, it := range items {
		row := it.(map[string]any)
		if row["hasError"].(bool) {
			sawError = true
		}
	}
	if !sawError {
		t.Errorf("expected at least one trace with hasError=true")
	}
}

func TestTrace_CorrelationJoin(t *testing.T) {
	s := seedStore(t)
	// Root of trace 2 has traceId 02000000000000000000000000000000.
	traceID := "02000000000000000000000000000000"
	data := exec(t, s, `query($id: ID!) { trace(traceId: $id) { traceId spanCount logs { body } } }`, map[string]any{"id": traceID})
	trace := data["trace"].(map[string]any)
	if trace["traceId"] != traceID {
		t.Errorf("traceId = %v, want %s", trace["traceId"], traceID)
	}
	logs := trace["logs"].([]any)
	if len(logs) != 1 {
		t.Fatalf("logs len = %d, want 1 (the correlated one)", len(logs))
	}
	if logs[0].(map[string]any)["body"] != "db timeout" {
		t.Errorf("correlated log body = %v, want 'db timeout'", logs[0])
	}
}

func TestTrace_Missing(t *testing.T) {
	s := seedStore(t)
	data := exec(t, s, `{ trace(traceId: "deadbeef") { traceId } }`, nil)
	if data["trace"] != nil {
		t.Errorf("trace = %v, want nil", data["trace"])
	}
}

func TestLogs_TraceIDFilter(t *testing.T) {
	s := seedStore(t)
	data := exec(t, s, `{ logs(traceId: "02000000000000000000000000000000") { total items { body } } }`, nil)
	conn := data["logs"].(map[string]any)
	if conn["total"].(float64) != 1 {
		t.Errorf("total = %v, want 1", conn["total"])
	}
}

func TestMetrics_PointCountWithoutFetchingPoints(t *testing.T) {
	s := seedStore(t)
	data := exec(t, s, `{ metrics { items { name type pointCount } } }`, nil)
	items := data["metrics"].(map[string]any)["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("metrics len = %d, want 1", len(items))
	}
	m := items[0].(map[string]any)
	if m["name"] != "cpu.usage" {
		t.Errorf("name = %v", m["name"])
	}
	if m["pointCount"].(float64) != 3 {
		t.Errorf("pointCount = %v, want 3", m["pointCount"])
	}
	if _, hasDP := m["dataPoints"]; hasDP {
		t.Errorf("dataPoints should not be returned when not selected")
	}
}

func TestLogEdges_TraceAndSpan(t *testing.T) {
	s := seedStore(t)
	// The correlated log was attached to trace 02 but with no SpanID in
	// seedStore, so log.trace should resolve but log.span should be null.
	data := exec(t, s, `{
		logs(traceId: "02000000000000000000000000000000") {
			items {
				body
				trace { traceId hasError }
				span { spanId }
			}
		}
	}`, nil)
	items := data["logs"].(map[string]any)["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("logs len = %d, want 1", len(items))
	}
	row := items[0].(map[string]any)
	trace := row["trace"].(map[string]any)
	if trace["traceId"] != "02000000000000000000000000000000" {
		t.Errorf("log.trace.traceId = %v", trace["traceId"])
	}
	if trace["hasError"].(bool) != true {
		t.Errorf("expected log.trace.hasError=true")
	}
	if row["span"] != nil {
		t.Errorf("log.span = %v, want nil (seedStore did not set a spanId on the log)", row["span"])
	}
}

func TestLogEdge_TraceNullWhenEvicted(t *testing.T) {
	s := seedStore(t)
	// Clear traces so correlation dangles.
	exec(t, s, `mutation { clearSignals }`, nil)
	// Re-seed just a log with a dangling traceId.
	s = store.NewStore(10, 10, 10, 100, nil)
	ld := plog.NewLogs()
	rl := ld.ResourceLogs().AppendEmpty()
	sl := rl.ScopeLogs().AppendEmpty()
	lr := sl.LogRecords().AppendEmpty()
	lr.SetTraceID(pcommon.TraceID([16]byte{9}))
	lr.Body().SetStr("orphan")
	s.AddLogs(ld)

	data := exec(t, s, `{ logs { items { body trace { traceId } } } }`, nil)
	items := data["logs"].(map[string]any)["items"].([]any)
	row := items[0].(map[string]any)
	if row["trace"] != nil {
		t.Errorf("log.trace = %v, want nil for evicted/missing trace", row["trace"])
	}
}

func TestSpanEdges_TraceAndParent(t *testing.T) {
	s := seedStore(t)
	data := exec(t, s, `{
		trace(traceId: "02000000000000000000000000000000") {
			spans {
				spanId
				parentSpanId
				trace { traceId }
				parent { spanId name }
			}
		}
	}`, nil)
	spans := data["trace"].(map[string]any)["spans"].([]any)
	if len(spans) != 2 {
		t.Fatalf("spans len = %d, want 2", len(spans))
	}
	var foundChildWithParent bool
	for _, sp := range spans {
		row := sp.(map[string]any)
		if row["trace"].(map[string]any)["traceId"] != "02000000000000000000000000000000" {
			t.Errorf("span.trace.traceId = %v", row["trace"])
		}
		if row["parentSpanId"] != "" && row["parent"] != nil {
			parent := row["parent"].(map[string]any)
			if parent["name"] == "root-2" {
				foundChildWithParent = true
			}
		}
	}
	if !foundChildWithParent {
		t.Errorf("expected child span to resolve parent to root-2")
	}
}

func TestClearMutation(t *testing.T) {
	s := seedStore(t)
	exec(t, s, `mutation { clearSignals }`, nil)
	traces, metrics, logs := s.Len()
	if traces != 0 || metrics != 0 || logs != 0 {
		t.Errorf("after clear: %d/%d/%d, want 0/0/0", traces, metrics, logs)
	}
}
