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

func (e *otelopExporter) pushTraces(_ context.Context, td ptrace.Traces) error {
	e.store.AddTraces(td)
	return nil
}

func (e *otelopExporter) pushMetrics(_ context.Context, md pmetric.Metrics) error {
	e.store.AddMetrics(md)
	return nil
}

func (e *otelopExporter) pushLogs(_ context.Context, ld plog.Logs) error {
	e.store.AddLogs(ld)
	return nil
}
