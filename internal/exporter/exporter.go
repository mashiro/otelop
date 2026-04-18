package exporter

import (
	"context"

	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"

	"github.com/mashiro/otelop/internal/store"
)

// otelopExporter pushes telemetry data into the in-memory store.
type otelopExporter struct {
	store *store.Store
}

func newExporter(s *store.Store) *otelopExporter {
	return &otelopExporter{store: s}
}

func (e *otelopExporter) pushTraces(ctx context.Context, td ptrace.Traces) error {
	e.store.AddTraces(ctx, td)
	return nil
}

func (e *otelopExporter) pushMetrics(ctx context.Context, md pmetric.Metrics) error {
	e.store.AddMetrics(ctx, md)
	return nil
}

func (e *otelopExporter) pushLogs(ctx context.Context, ld plog.Logs) error {
	e.store.AddLogs(ctx, ld)
	return nil
}
