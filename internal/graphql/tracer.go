package graphql

import (
	"context"
	"fmt"
	"log/slog"
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

	debug := slog.Default().Enabled(spanCtx, slog.LevelDebug)
	var start time.Time
	if debug {
		start = time.Now()
	}

	return spanCtx, func(errs []*errors.QueryError) {
		setSpanErrors(span, errs)
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
	spanCtx, span := otelTracer().Start(ctx, typeName+"."+fieldName)
	for name, value := range args {
		span.SetAttributes(attribute.String("graphql.args."+name, fmt.Sprintf("%v", value)))
	}
	return spanCtx, func(err *errors.QueryError) {
		if err != nil {
			span.SetStatus(codes.Error, err.Error())
		}
		span.End()
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
