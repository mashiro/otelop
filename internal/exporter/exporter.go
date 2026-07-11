package exporter

import (
	"context"

	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
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
	e.sink.AddTraces(ctx, td)
	return nil
}

func (e *otelopExporter) pushMetrics(ctx context.Context, md pmetric.Metrics) error {
	e.sink.AddMetrics(ctx, md)
	return nil
}

func (e *otelopExporter) pushLogs(ctx context.Context, ld plog.Logs) error {
	e.sink.AddLogs(ctx, ld)
	return nil
}
