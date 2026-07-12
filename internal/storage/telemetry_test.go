package storage

import (
	"context"
	"testing"
	"time"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestRegisterTelemetryCollectsDuckDBStateAndQueryMetrics(t *testing.T) {
	s := openTestStorage(t, Options{Path: t.TempDir() + "/telemetry.duckdb"})
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })

	if err := s.RegisterTelemetry(provider.Meter("test")); err != nil {
		t.Fatalf("RegisterTelemetry: %v", err)
	}
	_, _, err := s.LogsPage(context.Background(), time.Unix(0, 0), time.Now().Add(time.Hour), 0, 10, "")
	if err != nil {
		t.Fatalf("LogsPage: %v", err)
	}

	var resourceMetrics metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &resourceMetrics); err != nil {
		t.Fatalf("Collect: %v", err)
	}
	names := make(map[string]bool)
	for _, scope := range resourceMetrics.ScopeMetrics {
		for _, m := range scope.Metrics {
			names[m.Name] = true
		}
	}
	for _, name := range []string{
		"otelop.duckdb.query.duration",
		"otelop.duckdb.database.size",
		"otelop.duckdb.wal.size",
		"otelop.duckdb.blocks.total",
		"otelop.duckdb.blocks.used",
		"otelop.duckdb.blocks.free",
		"otelop.duckdb.memory.usage",
		"otelop.duckdb.temporary_storage.usage",
	} {
		if !names[name] {
			t.Errorf("metric %q was not collected", name)
		}
	}
}

func TestQueryTelemetryIsDisabledUntilRegistered(t *testing.T) {
	s := openTestStorage(t, Options{})
	if got := s.queryTelemetry.Load(); got != nil {
		t.Fatal("query telemetry enabled before RegisterTelemetry")
	}
}
