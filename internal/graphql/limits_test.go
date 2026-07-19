package graphql_test

import (
	"context"
	"strings"
	"testing"

	otelopgraphql "github.com/mashiro/otelop/internal/graphql"
	"github.com/mashiro/otelop/internal/storage"
)

// execErrors runs a query against s and returns the raw GraphQL errors
// (nil when none), for tests that assert on rejection rather than success —
// unlike exec() (schema_test.go), which fails the test on any error.
func execErrors(t *testing.T, s *storage.Storage, query string) []string {
	t.Helper()
	schema := otelopgraphql.MustNewSchema(s, testRuntime())
	resp := schema.Exec(context.Background(), query, "", nil)
	msgs := make([]string, len(resp.Errors))
	for i, e := range resp.Errors {
		msgs[i] = e.Error()
	}
	return msgs
}

// nestedTraceLogQuery builds a query that alternates through the schema's
// circular Trace.spans -> Span.trace -> Trace.logs -> Log.trace edges depth
// times, the exact shape schema.go's MaxDepth guards against
// (traces(limit:0){spans{trace{logs{trace{...}}}}}).
func nestedTraceLogQuery(depth int) string {
	var b strings.Builder
	b.WriteString(`{ trace(traceId: "x") {`)
	for i := 0; i < depth; i++ {
		b.WriteString(` spans { trace {`)
	}
	b.WriteString(` traceId `)
	for i := 0; i < depth; i++ {
		b.WriteString(` } } `)
	}
	b.WriteString(` } }`)
	return b.String()
}

func TestMaxDepth_RejectsDeeplyNestedCircularQuery(t *testing.T) {
	s := newTestStorage(t)
	// 20 round trips through spans/trace comfortably exceeds MaxDepth (15)
	// regardless of the exact counting convention.
	errs := execErrors(t, s, nestedTraceLogQuery(20))
	if len(errs) == 0 {
		t.Fatal("expected a MaxDepthExceeded error for a deeply nested query, got none")
	}
	found := false
	for _, e := range errs {
		if strings.Contains(e, "MaxDepthExceeded") || strings.Contains(e, "depth") {
			found = true
		}
	}
	if !found {
		t.Errorf("errors = %v, want a max-depth error", errs)
	}
}

// TestMaxDepth_AllowsFrontendShapedQuery guards against setting MaxDepth too
// low: the deepest real document the frontend sends (TraceById/TraceSpans —
// trace { spans { ...SpanFields } } with SpanFields' nested `events`) must
// still parse and execute without a depth error.
func TestMaxDepth_AllowsFrontendShapedQuery(t *testing.T) {
	s := seedStorage(t)
	errs := execErrors(t, s, `{
		trace(traceId: "02000000000000000000000000000000") {
			traceId
			serviceName
			spanCount
			startTime
			durationMs
			rootSpan { name kind statusCode durationMs }
			spans {
				traceId
				spanId
				parentSpanId
				name
				kind
				serviceName
				startTime
				endTime
				durationMs
				statusCode
				statusMessage
				attributes
				events { name timestamp attributes }
				resource
			}
		}
	}`)
	for _, e := range errs {
		if strings.Contains(e, "depth") || strings.Contains(e, "MaxDepth") {
			t.Errorf("frontend-shaped query rejected on depth: %v", errs)
		}
	}
}

// TestMaxDepth_AllowsIntrospectionExample guards the standard schema
// introspection query any GraphQL client runs to discover the schema before
// it knows the field names:
// '{ __schema { queryType { fields { name description args { name type { name ofType { name } } } } } } }'.
// It is deeper than any real data query (7 levels under graph-gophers'
// counting, root query field = depth 1) and must not be rejected.
func TestMaxDepth_AllowsIntrospectionExample(t *testing.T) {
	s := newTestStorage(t)
	errs := execErrors(t, s, `{ __schema { queryType { fields { name description args { name type { name ofType { name } } } } } } }`)
	for _, e := range errs {
		if strings.Contains(e, "depth") || strings.Contains(e, "MaxDepth") {
			t.Errorf("introspection example rejected on depth: %v", errs)
		}
	}
}

func TestMaxQueryLength_RejectsHugeQuery(t *testing.T) {
	s := newTestStorage(t)
	// Pad well past 50KB with a syntactically-valid (if pointless) alias list
	// on a cheap field, so the query is rejected for length, not parse errors.
	var b strings.Builder
	b.WriteString("{ config { ")
	for b.Len() < 60_000 {
		b.WriteString("traceCount ")
	}
	b.WriteString("} }")

	errs := execErrors(t, s, b.String())
	if len(errs) == 0 {
		t.Fatal("expected a max-query-length error for a 60KB query, got none")
	}
	found := false
	for _, e := range errs {
		if strings.Contains(e, "exceeds the maximum allowed query length") {
			found = true
		}
	}
	if !found {
		t.Errorf("errors = %v, want a max query length error", errs)
	}
}

func TestMaxQueryLength_AllowsRealisticQuery(t *testing.T) {
	s := seedStorage(t)
	// Nowhere near 50KB; must not be rejected.
	errs := execErrors(t, s, `{ traces(limit: 10) { items { traceId serviceName } } }`)
	if len(errs) != 0 {
		t.Errorf("realistic-size query rejected: %v", errs)
	}
}

// TestTracesLimit_ZeroClampsToDefault is the GraphQL-boundary regression
// test for storage's pageLimit "limit <= 0 means unlimited" sentinel
// (query_trace.go) being reachable directly through the `limit` arg — an
// explicit `traces(limit: 0)` must return a bounded default page, not every
// retained trace.
func TestTracesLimit_ZeroClampsToDefault(t *testing.T) {
	const n = 60 // comfortably above the 50-row default
	s := seedManyTraces(t, n)

	data := exec(t, s, `{ traces(limit: 0) { limit hasNextPage items { traceId } } }`, nil)
	conn := data["traces"].(map[string]any)
	if conn["limit"].(float64) != 50 {
		t.Errorf("limit = %v, want 50 (the clamped default)", conn["limit"])
	}
	items := conn["items"].([]any)
	if len(items) != 50 {
		t.Fatalf("items len = %d, want 50 (clamped, not all %d retained traces)", len(items), n)
	}
	if !conn["hasNextPage"].(bool) {
		t.Error("hasNextPage = false, want true (more than the clamped page remains)")
	}
}

func TestTracesLimit_ExcessiveClampsToMax(t *testing.T) {
	s := seedStorage(t)
	data := exec(t, s, `{ traces(limit: 100000) { limit } }`, nil)
	if got := data["traces"].(map[string]any)["limit"].(float64); got != 1000 {
		t.Errorf("limit = %v, want 1000 (the clamped max)", got)
	}
}

func TestLogsLimit_ZeroClampsToDefault(t *testing.T) {
	s := seedStorage(t)
	data := exec(t, s, `{ logs(limit: 0) { limit } }`, nil)
	if got := data["logs"].(map[string]any)["limit"].(float64); got != 50 {
		t.Errorf("limit = %v, want 50 (the clamped default)", got)
	}
}

func TestLogsLimit_ExcessiveClampsToMax(t *testing.T) {
	s := seedStorage(t)
	data := exec(t, s, `{ logs(limit: 100000) { limit } }`, nil)
	if got := data["logs"].(map[string]any)["limit"].(float64); got != 1000 {
		t.Errorf("limit = %v, want 1000 (the clamped max)", got)
	}
}

// TestMetricsLimit_ZeroClampsToMaxNotSmallDefault documents a deliberate
// asymmetry: unlike traces/logs, the frontend's metrics list intentionally
// sends an explicit `limit: 0` today to mean "every metric group" (see
// hooks/use-initial-load.ts, hooks/use-metric-list-search.ts). Clamping that
// sentinel down to the small 50-row page default would silently truncate
// real metrics tabs with more than 50 (service, metric name) groups, so
// metrics' zero-sentinel clamps to the generous hard cap (1000) instead —
// still bounded, but high enough that no real deployment notices.
func TestMetricsLimit_ZeroClampsToMaxNotSmallDefault(t *testing.T) {
	s := seedStorage(t) // 1 metric group
	data := exec(t, s, `{ metrics(limit: 0) { limit hasNextPage items { name } } }`, nil)
	conn := data["metrics"].(map[string]any)
	if got := conn["limit"].(float64); got != 1000 {
		t.Errorf("limit = %v, want 1000 (metrics' zero-sentinel clamp target)", got)
	}
	if conn["hasNextPage"].(bool) {
		t.Error("hasNextPage = true, want false")
	}
	if len(conn["items"].([]any)) != 1 {
		t.Errorf("items len = %d, want 1 (unaffected by the clamp at this cardinality)", len(conn["items"].([]any)))
	}
}

func TestMetricsLimit_ExcessiveClampsToMax(t *testing.T) {
	s := seedStorage(t)
	data := exec(t, s, `{ metrics(limit: 100000) { limit } }`, nil)
	if got := data["metrics"].(map[string]any)["limit"].(float64); got != 1000 {
		t.Errorf("limit = %v, want 1000 (the clamped max)", got)
	}
}
