package storage

import (
	"context"

	"github.com/mashiro/otelop/internal/selftelemetry"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"
)

func startStorageSpan(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, oteltrace.Span) {
	if selftelemetry.TracingSuppressed(ctx) {
		return ctx, oteltrace.SpanFromContext(context.Background())
	}
	return otel.Tracer("otelop/storage").Start(ctx, name, oteltrace.WithAttributes(attrs...))
}

func endStorageSpan(span oteltrace.Span, err error) {
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	span.End()
}

func suppressTracing(ctx context.Context) context.Context {
	return selftelemetry.SuppressTracing(ctx)
}
