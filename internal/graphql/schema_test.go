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
	"github.com/mashiro/otelop/internal/storage"
)

// newTestStorage opens an in-memory storage.Storage (Path: "") for tests —
// same DuckDB engine as production, no file on disk, cleaned up automatically.
func newTestStorage(t *testing.T) *storage.Storage {
	t.Helper()
	s, err := storage.Open(context.Background(), storage.Options{})
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Errorf("storage.Close: %v", err)
		}
	})
	return s
}

func seedStorage(t *testing.T) *storage.Storage {
	t.Helper()
	s := newTestStorage(t)

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
	sp2.SetStartTimestamp(pcommon.NewTimestampFromTime(now.Add(time.Millisecond)))
	sp2.SetEndTimestamp(pcommon.NewTimestampFromTime(now.Add(10 * time.Millisecond)))

	sp2child := ss.Spans().AppendEmpty()
	sp2child.SetTraceID(pcommon.TraceID([16]byte{2}))
	sp2child.SetSpanID(pcommon.SpanID([8]byte{3}))
	sp2child.SetParentSpanID(pcommon.SpanID([8]byte{2}))
	sp2child.SetName("db")
	sp2child.SetStartTimestamp(pcommon.NewTimestampFromTime(now.Add(2 * time.Millisecond)))
	sp2child.SetEndTimestamp(pcommon.NewTimestampFromTime(now.Add(4 * time.Millisecond)))
	sp2child.Status().SetCode(ptrace.StatusCodeError)
	sp2child.Status().SetMessage("db down")

	s.AddTraces(context.Background(), td)

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
		dp.SetTimestamp(pcommon.NewTimestampFromTime(now.Add(time.Duration(i) * time.Millisecond)))
	}
	s.AddMetrics(context.Background(), md)

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

	s.AddLogs(context.Background(), ld)
	s.Sync()

	return s
}

// testRuntime returns a RuntimeInfo with a generous retention window so
// seedStorage's fixed 2026 timestamps always fall inside the default
// traces/metrics/logs query window regardless of when the test runs.
func testRuntime() otelopgraphql.RuntimeInfo {
	return otelopgraphql.RuntimeInfo{Retention: 100 * 365 * 24 * time.Hour}
}

func exec(t *testing.T, s *storage.Storage, query string, vars map[string]any) map[string]any {
	t.Helper()
	schema := otelopgraphql.MustNewSchema(s, testRuntime())
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
	otelopgraphql.MustNewSchema(newTestStorage(t), otelopgraphql.RuntimeInfo{})
}

func TestStatusQuery(t *testing.T) {
	s := seedStorage(t)
	started := time.Date(2026, 4, 13, 10, 0, 0, 0, time.UTC)
	runtime := testRuntime()
	runtime.Version = "v1.2.3"
	runtime.StartedAt = started
	runtime.HTTPAddr = ":4319"
	runtime.OTLPGRPCAddr = "0.0.0.0:4317"
	runtime.OTLPHTTPAddr = "0.0.0.0:4318"
	runtime.ProxyURL = "https://upstream.example.com:4317"
	runtime.ProxyProtocol = "grpc"
	runtime.Debug = true
	runtime.LogLevel = "debug"
	runtime.StoragePath = "/tmp/otelop.duckdb"
	runtime.RetentionDisplay = "7d"
	runtime.MaxSizeDisplay = "4GB"

	schema := otelopgraphql.MustNewSchema(s, runtime)
	resp := schema.Exec(context.Background(), `{
		status {
			version
			startedAt
			httpAddr
			otlpGrpcAddr
			otlpHttpAddr
			proxyUrl
			proxyProtocol
			debug
			logLevel
			dbSizeBytes
			config { traceCount metricCount logCount storagePath retention maxSize }
		}
	}`, "", nil)
	if len(resp.Errors) > 0 {
		t.Fatalf("graphql errors: %+v", resp.Errors)
	}
	var data map[string]any
	if err := json.Unmarshal(resp.Data, &data); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	st := data["status"].(map[string]any)
	if st["version"] != "v1.2.3" {
		t.Errorf("version = %v, want v1.2.3", st["version"])
	}
	if st["httpAddr"] != ":4319" {
		t.Errorf("httpAddr = %v", st["httpAddr"])
	}
	if st["otlpGrpcAddr"] != "0.0.0.0:4317" {
		t.Errorf("otlpGrpcAddr = %v", st["otlpGrpcAddr"])
	}
	if st["proxyUrl"] != "https://upstream.example.com:4317" {
		t.Errorf("proxyUrl = %v", st["proxyUrl"])
	}
	if st["proxyProtocol"] != "grpc" {
		t.Errorf("proxyProtocol = %v", st["proxyProtocol"])
	}
	if st["debug"] != true {
		t.Errorf("debug = %v", st["debug"])
	}
	if st["logLevel"] != "debug" {
		t.Errorf("logLevel = %v, want debug", st["logLevel"])
	}
	if _, ok := st["dbSizeBytes"].(float64); !ok {
		t.Errorf("dbSizeBytes = %v, want a number (0 for in-memory)", st["dbSizeBytes"])
	}
	cfg := st["config"].(map[string]any)
	if cfg["traceCount"].(float64) != 2 {
		t.Errorf("config.traceCount = %v, want 2", cfg["traceCount"])
	}
	if cfg["storagePath"] != "/tmp/otelop.duckdb" {
		t.Errorf("config.storagePath = %v", cfg["storagePath"])
	}
	if cfg["retention"] != "7d" {
		t.Errorf("config.retention = %v, want 7d", cfg["retention"])
	}
	if cfg["maxSize"] != "4GB" {
		t.Errorf("config.maxSize = %v, want 4GB", cfg["maxSize"])
	}
}

func TestConfig(t *testing.T) {
	s := seedStorage(t)
	data := exec(t, s, `{ config { storagePath retention maxSize traceCount logCount } }`, nil)
	cfg := data["config"].(map[string]any)
	if cfg["traceCount"].(float64) != 2 {
		t.Errorf("traceCount = %v, want 2", cfg["traceCount"])
	}
	if cfg["logCount"].(float64) != 2 {
		t.Errorf("logCount = %v, want 2", cfg["logCount"])
	}
}

func TestTraces_FieldSelection(t *testing.T) {
	s := seedStorage(t)
	data := exec(t, s, `{ traces(limit: 10) { hasNextPage items { traceId serviceName hasError spanCount durationMs } } }`, nil)
	conn := data["traces"].(map[string]any)
	if conn["hasNextPage"].(bool) {
		t.Error("hasNextPage = true, want false")
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

func TestTraces_TimeRangeArgs_ExcludeOutOfWindow(t *testing.T) {
	s := seedStorage(t)
	// A window entirely before the seeded data must return zero traces.
	data := exec(t, s, `query($from: Time!, $to: Time!) { traces(from: $from, to: $to) { items { traceId } hasNextPage } }`, map[string]any{
		"from": "2000-01-01T00:00:00Z",
		"to":   "2000-01-02T00:00:00Z",
	})
	conn := data["traces"].(map[string]any)
	if len(conn["items"].([]any)) != 0 || conn["hasNextPage"].(bool) {
		t.Errorf("out-of-window traces = %v", conn)
	}
}

func TestTrace_CorrelationJoin(t *testing.T) {
	s := seedStorage(t)
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
	s := seedStorage(t)
	data := exec(t, s, `{ trace(traceId: "deadbeef") { traceId } }`, nil)
	if data["trace"] != nil {
		t.Errorf("trace = %v, want nil", data["trace"])
	}
}

func TestLogs_TraceIDFilter(t *testing.T) {
	s := seedStorage(t)
	data := exec(t, s, `{ logs(traceId: "02000000000000000000000000000000") { total items { body } } }`, nil)
	conn := data["logs"].(map[string]any)
	if conn["total"].(float64) != 1 {
		t.Errorf("total = %v, want 1", conn["total"])
	}
}

// TestLogs_SearchArgFiltersAndReflectsInTotal is the GraphQL-level
// passthrough check for issue #161's `search` arg on the logs query — field
// semantics are covered exhaustively at the storage layer
// (query_log_search_test.go); this confirms the resolver forwards the arg.
func TestLogs_SearchArgFiltersAndReflectsInTotal(t *testing.T) {
	s := seedStorage(t)

	data := exec(t, s, `{ logs(search: "timeout") { total items { body } } }`, nil)
	conn := data["logs"].(map[string]any)
	if conn["total"].(float64) != 1 {
		t.Errorf("total = %v, want 1", conn["total"])
	}
	items := conn["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["body"] != "db timeout" {
		t.Errorf("items = %v, want [\"db timeout\"]", items)
	}

	data = exec(t, s, `{ logs(search: "no-such-log") { total } }`, nil)
	if data["logs"].(map[string]any)["total"].(float64) != 0 {
		t.Errorf("total = %v, want 0", data["logs"].(map[string]any)["total"])
	}

	// traceId given: search is ignored, same as from/to (see resolver.go's
	// Logs — the trace-correlation branch never consults search).
	data = exec(t, s, `{ logs(traceId: "02000000000000000000000000000000", search: "no-such-log") { total } }`, nil)
	if data["logs"].(map[string]any)["total"].(float64) != 1 {
		t.Errorf("total = %v, want 1 (traceId filter takes precedence over search)", data["logs"].(map[string]any)["total"])
	}
}

func TestMetrics_PointCountWithoutFetchingPoints(t *testing.T) {
	s := seedStorage(t)
	data := exec(t, s, `{ metrics { items { name type pointCount resource } } }`, nil)
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
	resource := m["resource"].(map[string]any)
	if resource["service.name"] != "svc-a" {
		t.Errorf("resource = %v, want the metric's full resource attributes", resource)
	}
}

// buildCumulativeSumMetric mirrors internal/storage's test-only
// buildCumulativeSum (unexported there, so duplicated here rather than
// exported purely for a test) — a single monotonic cumulative Sum
// observation for the given (service, metric name) at ts.
func buildCumulativeSumMetric(name, service string, v float64, ts time.Time) pmetric.Metrics {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", service)
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName(name)
	sum := m.SetEmptySum()
	sum.SetIsMonotonic(true)
	sum.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	dp := sum.DataPoints().AppendEmpty()
	dp.SetDoubleValue(v)
	dp.SetTimestamp(pcommon.NewTimestampFromTime(ts))
	return md
}

// TestMetric_LatestValueWithoutFetchingPoints is the GraphQL-level companion
// to TestMetrics_PointCountWithoutFetchingPoints: latestValue must resolve
// without the query selecting dataPoints (issue #162's whole point).
func TestMetric_LatestValueWithoutFetchingPoints(t *testing.T) {
	s := seedStorage(t)
	data := exec(t, s, `{ metrics { items { name latestValue } } }`, nil)
	items := data["metrics"].(map[string]any)["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("metrics len = %d, want 1", len(items))
	}
	m := items[0].(map[string]any)
	// seedStorage's cpu.usage is a Gauge (passthrough, no baseline to drop);
	// its last written point is 2.5 (i=2 => float64(i)+0.5).
	if v, ok := m["latestValue"].(float64); !ok || v != 2.5 {
		t.Errorf("latestValue = %v, want 2.5", m["latestValue"])
	}
	if _, hasDP := m["dataPoints"]; hasDP {
		t.Errorf("dataPoints should not be returned when not selected")
	}
}

func TestMetricPoints_ReturnsDerivedPointsForOneGroup(t *testing.T) {
	s := newTestStorage(t)
	ctx := context.Background()
	t0 := time.Date(2026, 4, 11, 12, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildCumulativeSumMetric("requests.total", "svc-mp", 100, t0))
	s.AddMetrics(ctx, buildCumulativeSumMetric("requests.total", "svc-mp", 150, t0.Add(time.Second)))
	// A second, unrelated metric name in the same service — must not appear.
	s.AddMetrics(ctx, buildCumulativeSumMetric("other.metric", "svc-mp", 1, t0))
	s.Sync()

	data := exec(t, s, `
		query($from: Time!) {
			metricPoints(serviceName: "svc-mp", name: "requests.total", from: $from) {
				value
				cumulative
			}
		}
	`, map[string]any{"from": t0.Add(-time.Minute).Format(time.RFC3339)})

	points := data["metricPoints"].([]any)
	// The baseline observation (first point, no prior value to derive a
	// delta against) is filtered out — same NULL-baseline rule
	// metrics.dataPoints applies — so only the second, derived point remains.
	if len(points) != 1 {
		t.Fatalf("metricPoints len = %d, want 1 (baseline dropped)", len(points))
	}
	p := points[0].(map[string]any)
	if p["value"].(float64) != 50 {
		t.Errorf("value = %v, want 50 (150-100)", p["value"])
	}
	if p["cumulative"].(float64) != 150 {
		t.Errorf("cumulative = %v, want 150", p["cumulative"])
	}
}

// TestMetricPoints_RespectsFromTo verifies the query's time-range args are
// plumbed through to storage.MetricPoints rather than always fetching the
// full retention window.
func TestMetricPoints_RespectsFromTo(t *testing.T) {
	s := newTestStorage(t)
	ctx := context.Background()
	t0 := time.Date(2026, 4, 11, 12, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildCumulativeSumMetric("m", "svc-mp2", 1, t0))
	s.AddMetrics(ctx, buildCumulativeSumMetric("m", "svc-mp2", 2, t0.Add(time.Hour)))
	s.Sync()

	data := exec(t, s, `
		query($from: Time!, $to: Time!) {
			metricPoints(serviceName: "svc-mp2", name: "m", from: $from, to: $to) { value }
		}
	`, map[string]any{
		"from": t0.Add(30 * time.Minute).Format(time.RFC3339),
		"to":   t0.Add(90 * time.Minute).Format(time.RFC3339),
	})

	points := data["metricPoints"].([]any)
	// from/to excludes the t0 observation entirely, so the t0+1h point is the
	// only row the window ever sees — with no in-window predecessor to lag
	// against, it's a fresh (filtered) baseline within this window, same as
	// storage's TestMetricPoints_TimeRangeFiltering. This proves from/to
	// actually reached storage.MetricPoints: an unbounded query would have
	// included the t0 point and derived a non-baseline value=1 for this one.
	if len(points) != 0 {
		t.Fatalf("metricPoints len = %d, want 0 (windowed out the earlier point this delta needs)", len(points))
	}
}

func TestLogEdges_TraceAndSpan(t *testing.T) {
	s := seedStorage(t)
	// The correlated log was attached to trace 02 but with no SpanID in
	// seedStorage, so log.trace should resolve but log.span should be null.
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
		t.Errorf("log.span = %v, want nil (seedStorage did not set a spanId on the log)", row["span"])
	}
}

func TestLogEdge_TraceNullWhenMissing(t *testing.T) {
	s := newTestStorage(t)
	ld := plog.NewLogs()
	rl := ld.ResourceLogs().AppendEmpty()
	sl := rl.ScopeLogs().AppendEmpty()
	lr := sl.LogRecords().AppendEmpty()
	lr.SetTraceID(pcommon.TraceID([16]byte{9}))
	lr.Body().SetStr("orphan")
	lr.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	s.AddLogs(context.Background(), ld)
	s.Sync()

	data := exec(t, s, `{ logs { items { body trace { traceId } } } }`, nil)
	items := data["logs"].(map[string]any)["items"].([]any)
	row := items[0].(map[string]any)
	if row["trace"] != nil {
		t.Errorf("log.trace = %v, want nil for missing trace", row["trace"])
	}
}

func TestSpanEdges_TraceAndParent(t *testing.T) {
	s := seedStorage(t)
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

// TestMetricAggregate_SumsAcrossFacetGroup is the GraphQL-level regression
// test for the zigzag bug: two attribute-series sharing a facet value
// (region=A) but differing on another attribute (worker) must sum into one
// value per bucket when queried through metricAggregate, not surface as two
// interleaved raw points.
func TestMetricAggregate_SumsAcrossFacetGroup(t *testing.T) {
	s := newTestStorage(t)
	ctx := context.Background()
	t0 := time.Date(2026, 4, 11, 12, 0, 0, 0, time.UTC)

	build := func(v float64, region, worker string) pmetric.Metrics {
		md := pmetric.NewMetrics()
		rm := md.ResourceMetrics().AppendEmpty()
		rm.Resource().Attributes().PutStr("service.name", "svc-agg")
		sm := rm.ScopeMetrics().AppendEmpty()
		m := sm.Metrics().AppendEmpty()
		m.SetName("reqs")
		sum := m.SetEmptySum()
		sum.SetIsMonotonic(true)
		sum.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
		dp := sum.DataPoints().AppendEmpty()
		dp.SetDoubleValue(v)
		dp.SetTimestamp(pcommon.NewTimestampFromTime(t0))
		dp.Attributes().PutStr("region", region)
		dp.Attributes().PutStr("worker", worker)
		return md
	}
	s.AddMetrics(ctx, build(5, "A", "1"))
	s.AddMetrics(ctx, build(3, "A", "2"))
	s.AddMetrics(ctx, build(9, "B", "1"))
	s.Sync()

	data := exec(t, s, `
		query($from: Time!) {
			metricAggregate(serviceName: "svc-agg", name: "reqs", groupBy: ["region"], bucketSeconds: 60, from: $from) {
				groupValues
				points { value count sum min max }
			}
		}
	`, map[string]any{"from": t0.Add(-time.Hour).Format(time.RFC3339)})

	series := data["metricAggregate"].([]any)
	if len(series) != 2 {
		t.Fatalf("expected 2 groups (region A and B), got %d: %+v", len(series), series)
	}

	byGroup := map[string][]any{}
	for _, raw := range series {
		g := raw.(map[string]any)
		values := g["groupValues"].([]any)
		byGroup[values[0].(string)] = g["points"].([]any)
	}

	pointsA, ok := byGroup["A"]
	if !ok || len(pointsA) != 1 {
		t.Fatalf("group A points = %+v, want exactly 1", pointsA)
	}
	if v := pointsA[0].(map[string]any)["value"].(float64); v != 8 {
		t.Errorf("group A value = %v, want 8 (5+3, summed not zigzagged)", v)
	}

	pointsB, ok := byGroup["B"]
	if !ok || len(pointsB) != 1 {
		t.Fatalf("group B points = %+v, want exactly 1", pointsB)
	}
	if v := pointsB[0].(map[string]any)["value"].(float64); v != 9 {
		t.Errorf("group B value = %v, want 9 (single series, passthrough)", v)
	}
}

// TestMetricAggregate_AutoBucketsWhenBucketSecondsOmitted verifies the
// GraphQL layer plumbs a wholly-omitted bucketSeconds through as storage's
// auto-bucket sentinel (0), rather than erroring on a required-Int argument
// or defaulting to some fixed value here.
func TestMetricAggregate_AutoBucketsWhenBucketSecondsOmitted(t *testing.T) {
	s := newTestStorage(t)
	ctx := context.Background()
	t0 := time.Date(2026, 4, 11, 12, 0, 0, 0, time.UTC)

	build := func(v float64, ts time.Time) pmetric.Metrics {
		md := pmetric.NewMetrics()
		rm := md.ResourceMetrics().AppendEmpty()
		rm.Resource().Attributes().PutStr("service.name", "svc-agg-auto")
		sm := rm.ScopeMetrics().AppendEmpty()
		m := sm.Metrics().AppendEmpty()
		m.SetName("reqs")
		sum := m.SetEmptySum()
		sum.SetIsMonotonic(true)
		sum.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
		dp := sum.DataPoints().AppendEmpty()
		dp.SetDoubleValue(v)
		dp.SetTimestamp(pcommon.NewTimestampFromTime(ts))
		dp.Attributes().PutStr("region", "A")
		return md
	}
	for i := range 90 {
		s.AddMetrics(ctx, build(float64(i), t0.Add(time.Duration(i)*60*time.Second)))
	}
	s.Sync()

	data := exec(t, s, `
		query($from: Time!) {
			metricAggregate(serviceName: "svc-agg-auto", name: "reqs", groupBy: ["region"], from: $from) {
				groupValues
				points { value }
			}
		}
	`, map[string]any{"from": t0.Add(-7 * 24 * time.Hour).Format(time.RFC3339)})

	series := data["metricAggregate"].([]any)
	if len(series) != 1 {
		t.Fatalf("expected 1 group, got %d: %+v", len(series), series)
	}
	points := series[0].(map[string]any)["points"].([]any)
	if n := len(points); n <= 40 {
		t.Fatalf("expected > 40 auto-bucketed points, got %d", n)
	}
}

func TestMetricAggregate_RejectsEmptyGroupBy(t *testing.T) {
	s := seedStorage(t)
	schema := otelopgraphql.MustNewSchema(s, testRuntime())
	resp := schema.Exec(context.Background(), `
		{ metricAggregate(serviceName: "svc-a", name: "cpu.usage", groupBy: [], bucketSeconds: 60) {
			groupValues
		} }
	`, "", nil)
	if len(resp.Errors) == 0 {
		t.Fatal("expected a GraphQL error for empty groupBy, got none")
	}
}

func TestClearMutation(t *testing.T) {
	s := seedStorage(t)
	exec(t, s, `mutation { clearSignals }`, nil)
	traces, metrics, logs, err := s.Counts(context.Background())
	if err != nil {
		t.Fatalf("Counts: %v", err)
	}
	if traces != 0 || metrics != 0 || logs != 0 {
		t.Errorf("after clear: %d/%d/%d, want 0/0/0", traces, metrics, logs)
	}
}
