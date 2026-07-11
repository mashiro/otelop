package graphql

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/graph-gophers/graphql-go/errors"
	"github.com/graph-gophers/graphql-go/introspection"
	"github.com/graph-gophers/graphql-go/trace/tracer"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"
)

// slogTracer is the single Tracer wired into the schema. It does two things:
//
//   - emits one slog.Debug record per query with op/duration/vars/errors so
//     `otelop --log-level debug` gives a plain-text access log equivalent to
//     what the REST handlers had;
//   - starts OpenTelemetry spans for each GraphQL operation and every
//     non-trivial field so the same requests appear in otelop's own trace
//     stream when `--debug` self-telemetry is enabled (no-op otherwise).
//
// Trivial fields (simple struct accessors without args) are intentionally
// skipped — tracing those would drown the span list without adding signal.
type slogTracer struct{}

// resolve the otel tracer lazily: the global provider may be swapped after
// package init (notably in tests via otel.SetTracerProvider).
func otelTracer() oteltrace.Tracer {
	return otel.Tracer("otelop.graphql")
}

var noopFieldFinish tracer.FieldFinishFunc = func(*errors.QueryError) {}
var noopValidationFinish tracer.ValidationFinishFunc = func([]*errors.QueryError) {}

// maxFieldSpansPerRequest bounds how many real OTel spans one (parentType,
// field) pair may create within a single GraphQL request. This is the fix
// for self-observation amplifying an N+1 into a thousand-span trace instead
// of just revealing it: the bug this guards against resolved Trace.spans
// (then Trace.rootSpan) once per row of an 815-trace list, producing an
// 861-span/~800ms trace for one page load — see trace_resolver_test.go's
// TestTracesList_SummaryFieldsDoNotTriggerTraceByID for the SQL-side half of
// that fix. The first N occurrences of a given field still get a full span
// (enough to see the shape of the problem); the rest are counted and
// reported as a single attribute on the request span instead of drowning it
// in near-duplicate spans.
const maxFieldSpansPerRequest = 10

// fieldSpanBudget tracks per-request, per-(parentType.field) span counts so
// TraceField can enforce maxFieldSpansPerRequest. It is stashed on the
// request context by TraceQuery; graph-gophers can resolve sibling fields
// concurrently, so access is mutex-guarded.
type fieldSpanBudget struct {
	mu      sync.Mutex
	started map[string]int
	dropped map[string]int
}

func newFieldSpanBudget() *fieldSpanBudget {
	return &fieldSpanBudget{started: map[string]int{}, dropped: map[string]int{}}
}

// admit reports whether key may start a real span, else records a drop.
func (b *fieldSpanBudget) admit(key string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.started[key] >= maxFieldSpansPerRequest {
		b.dropped[key]++
		return false
	}
	b.started[key]++
	return true
}

// snapshotDrops returns a copy of the per-key drop counts, safe to read
// after the request has finished resolving (TraceQuery's finish func).
func (b *fieldSpanBudget) snapshotDrops() map[string]int {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make(map[string]int, len(b.dropped))
	for k, v := range b.dropped {
		out[k] = v
	}
	return out
}

type fieldSpanBudgetKey struct{}

func (slogTracer) TraceQuery(
	ctx context.Context,
	query string,
	operationName string,
	variables map[string]any,
	_ map[string]*introspection.Type,
) (context.Context, tracer.QueryFinishFunc) {
	spanCtx, span := otelTracer().Start(ctx, "graphql.query")
	span.SetAttributes(attribute.String("graphql.query", query))
	if operationName != "" {
		span.SetAttributes(attribute.String("graphql.operation", operationName))
	}
	if len(variables) > 0 {
		span.SetAttributes(attribute.String("graphql.variables", fmt.Sprintf("%v", variables)))
	}

	budget := newFieldSpanBudget()
	spanCtx = context.WithValue(spanCtx, fieldSpanBudgetKey{}, budget)

	debug := slog.Default().Enabled(spanCtx, slog.LevelDebug)
	var start time.Time
	if debug {
		start = time.Now()
	}

	return spanCtx, func(errs []*errors.QueryError) {
		setSpanErrors(span, errs)
		for key, n := range budget.snapshotDrops() {
			span.SetAttributes(attribute.Int64("graphql.fields.dropped."+key, int64(n)))
		}
		span.End()
		if !debug {
			return
		}
		attrs := []any{
			"op", operationName,
			"duration", time.Since(start),
			"query", query,
		}
		if len(variables) > 0 {
			attrs = append(attrs, "variables", variables)
		}
		if len(errs) > 0 {
			attrs = append(attrs, "errors", errs)
		}
		slog.DebugContext(spanCtx, "graphql query", attrs...)
	}
}

func (slogTracer) TraceField(
	ctx context.Context,
	_ string,
	typeName string,
	fieldName string,
	trivial bool,
	args map[string]any,
) (context.Context, tracer.FieldFinishFunc) {
	if trivial {
		return ctx, noopFieldFinish
	}
	// Top-level Query/Mutation fields are always traced — there are at most
	// a handful per request, and they're what the request-level span's
	// children should always show regardless of how a nested list field
	// fares against the budget below.
	if typeName != "Query" && typeName != "Mutation" {
		if budget, ok := ctx.Value(fieldSpanBudgetKey{}).(*fieldSpanBudget); ok {
			if !budget.admit(typeName + "." + fieldName) {
				return ctx, noopFieldFinish
			}
		}
	}
	spanCtx, span := otelTracer().Start(ctx, typeName+"."+fieldName)
	for name, value := range args {
		span.SetAttributes(argAttribute("graphql.args."+name, value))
	}
	return spanCtx, func(err *errors.QueryError) {
		if err != nil {
			span.SetStatus(codes.Error, err.Error())
		}
		span.End()
	}
}

// argAttribute preserves the argument's underlying type on the span so
// integer / boolean arguments aren't flattened into strings in the trace
// viewer. Compound values fall back to Sprintf because OTel attributes are
// scalar-only.
func argAttribute(key string, v any) attribute.KeyValue {
	switch x := v.(type) {
	case nil:
		return attribute.String(key, "")
	case bool:
		return attribute.Bool(key, x)
	case int32:
		return attribute.Int64(key, int64(x))
	case int64:
		return attribute.Int64(key, x)
	case int:
		return attribute.Int(key, x)
	case float64:
		return attribute.Float64(key, x)
	case string:
		return attribute.String(key, x)
	default:
		return attribute.String(key, fmt.Sprintf("%v", v))
	}
}

func (slogTracer) TraceValidation(ctx context.Context) tracer.ValidationFinishFunc {
	debug := slog.Default().Enabled(ctx, slog.LevelDebug)
	if !debug {
		return noopValidationFinish
	}
	return func(errs []*errors.QueryError) {
		if len(errs) == 0 {
			return
		}
		slog.DebugContext(ctx, "graphql validation failed", "errors", errs)
	}
}

func setSpanErrors(span oteltrace.Span, errs []*errors.QueryError) {
	if len(errs) == 0 {
		return
	}
	msg := errs[0].Error()
	if len(errs) > 1 {
		msg += fmt.Sprintf(" (and %d more errors)", len(errs)-1)
	}
	span.SetStatus(codes.Error, msg)
}
