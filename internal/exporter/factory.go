package exporter

import (
	"context"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/consumer"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/exporter/exporterhelper"

	"github.com/mashiro/otelop/internal/store"
)

const typeStr = "otelop"

// NewFactory creates a new exporter factory wired to the given store.
func NewFactory(s *store.Store) exporter.Factory {
	exp := newExporter(s)
	return exporter.NewFactory(
		component.MustNewType(typeStr),
		func() component.Config { return &Config{} },
		exporter.WithTraces(func(
			ctx context.Context,
			set exporter.Settings,
			cfg component.Config,
		) (exporter.Traces, error) {
			return exporterhelper.NewTraces(ctx, set, cfg,
				exp.pushTraces,
				exporterhelper.WithCapabilities(consumer.Capabilities{MutatesData: false}),
			)
		}, component.StabilityLevelDevelopment),
		exporter.WithMetrics(func(
			ctx context.Context,
			set exporter.Settings,
			cfg component.Config,
		) (exporter.Metrics, error) {
			return exporterhelper.NewMetrics(ctx, set, cfg,
				exp.pushMetrics,
				exporterhelper.WithCapabilities(consumer.Capabilities{MutatesData: false}),
			)
		}, component.StabilityLevelDevelopment),
		exporter.WithLogs(func(
			ctx context.Context,
			set exporter.Settings,
			cfg component.Config,
		) (exporter.Logs, error) {
			return exporterhelper.NewLogs(ctx, set, cfg,
				exp.pushLogs,
				exporterhelper.WithCapabilities(consumer.Capabilities{MutatesData: false}),
			)
		}, component.StabilityLevelDevelopment),
	)
}
