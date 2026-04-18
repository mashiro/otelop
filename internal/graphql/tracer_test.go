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
	"github.com/mashiro/otelop/internal/store"
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

	schema := otelopgraphql.MustNewSchema(store.NewStore(1, 1, 1, 1, nil), otelopgraphql.RuntimeInfo{})
	schema.Exec(context.Background(), `query Probe { config { traceCap } }`, "", nil)

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

	schema := otelopgraphql.MustNewSchema(store.NewStore(1, 1, 1, 1, nil), otelopgraphql.RuntimeInfo{})
	schema.Exec(context.Background(), `{ config { traceCap } }`, "", nil)

	if buf.Len() != 0 {
		t.Errorf("expected no log output, got %q", buf.String())
	}
}

func TestTracer_EmitsOtelSpans(t *testing.T) {
	rec := installSpanRecorder(t)

	schema := otelopgraphql.MustNewSchema(store.NewStore(1, 1, 1, 1, nil), otelopgraphql.RuntimeInfo{})
	// `traces` takes args, so graph-gophers marks it async and TraceField is
	// invoked with trivial=false — which is where our field-level span fires.
	schema.Exec(context.Background(), `query Probe { traces(limit: 1) { total } }`, "", nil)

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

func TestTracer_LogsValidationFailure(t *testing.T) {
	orig := slog.Default()
	t.Cleanup(func() { slog.SetDefault(orig) })

	var buf bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))

	schema := otelopgraphql.MustNewSchema(store.NewStore(1, 1, 1, 1, nil), otelopgraphql.RuntimeInfo{})
	schema.Exec(context.Background(), `{ nonexistentField }`, "", nil)

	out := buf.String()
	if !strings.Contains(out, "validation failed") {
		t.Errorf("expected validation failure log, got %q", out)
	}
}
