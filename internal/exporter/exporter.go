package exporter

import (
	"context"

	"github.com/mashiro/otelop/internal/selftelemetry"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// Sink is the set of ingest methods the exporter needs. internal/storage.Storage
// satisfies it with the identical signatures the old store package's Store used, so
// swapping the backing store is a one-line change at the call site; tests can
// supply a fake instead of standing up a real database.
type Sink interface {
	AddTraces(ctx context.Context, td ptrace.Traces)
	AddMetrics(ctx context.Context, md pmetric.Metrics)
	AddLogs(ctx context.Context, ld plog.Logs)
}

// otelopExporter pushes telemetry data into a Sink.
type otelopExporter struct {
	sink Sink
}

func newExporter(s Sink) *otelopExporter {
	return &otelopExporter{sink: s}
}

func (e *otelopExporter) pushTraces(ctx context.Context, td ptrace.Traces) error {
	if selftelemetry.TracesAreInternal(td) {
		ctx = selftelemetry.SuppressTracing(ctx)
	}
	ctx, span := startExporterSpan(ctx, "exporter.pushTraces", attribute.Int("storage.batch.rows", td.SpanCount()))
	defer span.End()
	e.sink.AddTraces(ctx, td)
	return nil
}

func (e *otelopExporter) pushMetrics(ctx context.Context, md pmetric.Metrics) error {
	if selftelemetry.MetricsAreInternal(md) {
		ctx = selftelemetry.SuppressTracing(ctx)
	}
	ctx, span := startExporterSpan(ctx, "exporter.pushMetrics", attribute.Int("storage.batch.rows", md.DataPointCount()))
	defer span.End()
	e.sink.AddMetrics(ctx, md)
	return nil
}

func (e *otelopExporter) pushLogs(ctx context.Context, ld plog.Logs) error {
	if selftelemetry.LogsAreInternal(ld) {
		ctx = selftelemetry.SuppressTracing(ctx)
	}
	ctx, span := startExporterSpan(ctx, "exporter.pushLogs", attribute.Int("storage.batch.rows", ld.LogRecordCount()))
	defer span.End()
	e.sink.AddLogs(ctx, ld)
	return nil
}

func startExporterSpan(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	if selftelemetry.TracingSuppressed(ctx) {
		return ctx, trace.SpanFromContext(context.Background())
	}
	return otel.Tracer("otelop/exporter").Start(ctx, name, trace.WithAttributes(attrs...))
}
