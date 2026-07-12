package graphql_test

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	otelopgraphql "github.com/mashiro/otelop/internal/graphql"
)

func installSpanRecorder(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
	orig := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	t.Cleanup(func() { otel.SetTracerProvider(orig) })
	return rec
}

func TestTracer_LogsQueryAtDebug(t *testing.T) {
	orig := slog.Default()
	t.Cleanup(func() { slog.SetDefault(orig) })

	var buf bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))

	schema := otelopgraphql.MustNewSchema(newTestStorage(t), otelopgraphql.RuntimeInfo{})
	schema.Exec(context.Background(), `query Probe { config { storagePath }  }`, "", nil)

	out := buf.String()
	if !strings.Contains(out, "graphql query") {
		t.Errorf("expected log line, got %q", out)
	}
	if !strings.Contains(out, "op=Probe") {
		t.Errorf("expected op=Probe in log, got %q", out)
	}
	if !strings.Contains(out, "duration=") {
		t.Errorf("expected duration attr, got %q", out)
	}
}

func TestTracer_SilentBelowDebug(t *testing.T) {
	orig := slog.Default()
	t.Cleanup(func() { slog.SetDefault(orig) })

	var buf bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))

	schema := otelopgraphql.MustNewSchema(newTestStorage(t), otelopgraphql.RuntimeInfo{})
	schema.Exec(context.Background(), `{ config { storagePath }  }`, "", nil)

	if buf.Len() != 0 {
		t.Errorf("expected no log output, got %q", buf.String())
	}
}

func TestTracer_EmitsOtelSpans(t *testing.T) {
	rec := installSpanRecorder(t)

	schema := otelopgraphql.MustNewSchema(newTestStorage(t), otelopgraphql.RuntimeInfo{})
	// `traces` takes args, so graph-gophers marks it async and TraceField is
	// invoked with trivial=false — which is where our field-level span fires.
	schema.Exec(context.Background(), `query Probe { traces(limit: 1) { hasNextPage } }`, "", nil)

	spans := rec.Ended()
	names := make([]string, len(spans))
	for i, s := range spans {
		names[i] = s.Name()
	}

	var seenQuery bool
	var tracesSpan sdktrace.ReadOnlySpan
	for i, n := range names {
		if n == "graphql.query" {
			seenQuery = true
		}
		if n == "Query.traces" {
			tracesSpan = spans[i]
		}
	}
	if !seenQuery {
		t.Errorf("expected graphql.query span, got %v", names)
	}
	if tracesSpan == nil {
		t.Fatalf("expected Query.traces span, got %v", names)
	}

	var limitAttr attribute.KeyValue
	for _, attr := range tracesSpan.Attributes() {
		if string(attr.Key) == "graphql.args.limit" {
			limitAttr = attr
			break
		}
	}
	if limitAttr.Key == "" {
		t.Fatalf("expected graphql.args.limit on Query.traces span, got attrs %v", tracesSpan.Attributes())
	}
	if limitAttr.Value.Type() != attribute.INT64 {
		t.Errorf("graphql.args.limit type = %v, want INT64", limitAttr.Value.Type())
	}
	if got := limitAttr.Value.AsInt64(); got != 1 {
		t.Errorf("graphql.args.limit = %d, want 1", got)
	}
}

// TestTracer_CapsPerFieldSpansAndRecordsDropCount is the regression test for
// self-observation amplifying an N+1 into a thousand-span trace: a field
// resolved on every row of a list (here Trace.spans, deliberately re-tickled
// via seedManyTraces/exec's helpers from trace_resolver_test.go) must stop
// minting new spans past maxFieldSpansPerRequest, with the remainder
// recorded as one attribute on the request-level span instead.
func TestTracer_CapsPerFieldSpansAndRecordsDropCount(t *testing.T) {
	rec := installSpanRecorder(t)

	const n = 15
	s := seedManyTraces(t, n)

	schema := otelopgraphql.MustNewSchema(s, testRuntime())
	schema.Exec(context.Background(), `{
		traces(limit: 0) {
			items { spanCount spans { name } }
		}
	}`, "", nil)

	spans := rec.Ended()
	var fieldSpanCount int
	var querySpan sdktrace.ReadOnlySpan
	for _, sp := range spans {
		if sp.Name() == "Trace.spans" {
			fieldSpanCount++
		}
		if sp.Name() == "graphql.query" {
			querySpan = sp
		}
	}
	if fieldSpanCount != 10 {
		t.Errorf("Trace.spans span count = %d, want capped at 10", fieldSpanCount)
	}
	if querySpan == nil {
		t.Fatalf("expected a graphql.query span, got %v", spans)
	}

	var dropped attribute.KeyValue
	for _, attr := range querySpan.Attributes() {
		if string(attr.Key) == "graphql.fields.dropped.Trace.spans" {
			dropped = attr
		}
	}
	if dropped.Key == "" {
		t.Fatalf("expected graphql.fields.dropped.Trace.spans on the request span, got %v", querySpan.Attributes())
	}
	if got := dropped.Value.AsInt64(); got != int64(n-10) {
		t.Errorf("dropped count = %d, want %d", got, n-10)
	}
}

// TestTracer_TopLevelFieldsExemptFromCap verifies Query/Mutation fields are
// always traced regardless of the per-field budget — there's at most a
// handful per request, and they're the spans a request-level view should
// always show.
func TestTracer_TopLevelFieldsExemptFromCap(t *testing.T) {
	rec := installSpanRecorder(t)

	// 15 exceeds the 10-per-field cap (see tracer.go's maxFieldSpansPerRequest)
	// so this also incidentally proves top-level fields aren't budgeted like
	// Trace.spans is in TestTracer_CapsPerFieldSpansAndRecordsDropCount.
	s := seedManyTraces(t, 15)
	schema := otelopgraphql.MustNewSchema(s, testRuntime())
	// Two top-level fields in one request — more than maxFieldSpansPerRequest
	// would ever matter for, but exercises that Query.* isn't budgeted at all.
	schema.Exec(context.Background(), `{
		a: traces(limit: 0) { hasNextPage }
		b: traces(limit: 1) { hasNextPage }
	}`, "", nil)

	var queryFieldSpans int
	for _, sp := range rec.Ended() {
		if sp.Name() == "Query.traces" {
			queryFieldSpans++
		}
	}
	if queryFieldSpans != 2 {
		t.Errorf("Query.traces span count = %d, want 2 (top-level fields exempt from the cap)", queryFieldSpans)
	}
}

func TestTracer_LogsValidationFailure(t *testing.T) {
	orig := slog.Default()
	t.Cleanup(func() { slog.SetDefault(orig) })

	var buf bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))

	schema := otelopgraphql.MustNewSchema(newTestStorage(t), otelopgraphql.RuntimeInfo{})
	schema.Exec(context.Background(), `{ nonexistentField }`, "", nil)

	out := buf.String()
	if !strings.Contains(out, "validation failed") {
		t.Errorf("expected validation failure log, got %q", out)
	}
}
