package storage

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestRegisterTelemetryCollectsStorageMetrics(t *testing.T) {
	s := openTestStorage(t, Options{
		Path:     t.TempDir() + "/telemetry.duckdb",
		OnCommit: func(context.Context, CommitEvent) {},
	})
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })

	if err := s.RegisterTelemetry(provider.Meter("test")); err != nil {
		t.Fatalf("RegisterTelemetry: %v", err)
	}
	s.AddLogs(context.Background(), buildLog([16]byte{1}, "telemetry", "otelop", time.Now()))
	s.Sync()
	s.recordQueueDrop(context.Background(), "write", "logs")
	_, _, err := s.LogsPage(context.Background(), time.Unix(0, 0), time.Now().Add(time.Hour), nil, 10, "")
	if err != nil {
		t.Fatalf("LogsPage: %v", err)
	}

	var resourceMetrics metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &resourceMetrics); err != nil {
		t.Fatalf("Collect: %v", err)
	}
	metrics := make(map[string]metricdata.Metrics)
	for _, scope := range resourceMetrics.ScopeMetrics {
		for _, m := range scope.Metrics {
			metrics[m.Name] = m
		}
	}
	for _, name := range []string{
		"otelop.duckdb.query.duration",
		"otelop.duckdb.write.duration",
		"otelop.duckdb.write.rows",
		"otelop.duckdb.database.size",
		"otelop.duckdb.wal.size",
		"otelop.duckdb.blocks.total",
		"otelop.duckdb.blocks.used",
		"otelop.duckdb.blocks.free",
		"otelop.duckdb.memory.usage",
		"otelop.duckdb.temporary_storage.usage",
		"otelop.storage.commit.duration",
		"otelop.storage.queue.depth",
		"otelop.storage.queue.dropped",
	} {
		if _, ok := metrics[name]; !ok {
			t.Errorf("metric %q was not collected", name)
		}
	}

	writeRows := metrics["otelop.duckdb.write.rows"].Data.(metricdata.Sum[int64])
	if len(writeRows.DataPoints) != 1 || writeRows.DataPoints[0].Value != 1 {
		t.Fatalf("write rows = %+v, want one logs row", writeRows.DataPoints)
	}
	assertAttribute(t, writeRows.DataPoints[0].Attributes, "signal", "logs")

	writeDuration := metrics["otelop.duckdb.write.duration"].Data.(metricdata.Histogram[float64])
	if len(writeDuration.DataPoints) != 1 || writeDuration.DataPoints[0].Count != 1 {
		t.Fatalf("write duration = %+v, want one logs batch", writeDuration.DataPoints)
	}
	assertAttribute(t, writeDuration.DataPoints[0].Attributes, "signal", "logs")

	commitDuration := metrics["otelop.storage.commit.duration"].Data.(metricdata.Histogram[float64])
	if len(commitDuration.DataPoints) != 1 || commitDuration.DataPoints[0].Count != 1 {
		t.Fatalf("commit duration = %+v, want one logs delivery", commitDuration.DataPoints)
	}
	assertAttribute(t, commitDuration.DataPoints[0].Attributes, "signal", "logs")

	queueDropped := metrics["otelop.storage.queue.dropped"].Data.(metricdata.Sum[int64])
	if len(queueDropped.DataPoints) != 1 || queueDropped.DataPoints[0].Value != 1 {
		t.Fatalf("queue dropped = %+v, want one dropped logs batch", queueDropped.DataPoints)
	}
	assertAttribute(t, queueDropped.DataPoints[0].Attributes, "queue", "write")
	assertAttribute(t, queueDropped.DataPoints[0].Attributes, "signal", "logs")

	queueDepth := metrics["otelop.storage.queue.depth"].Data.(metricdata.Gauge[int64])
	if len(queueDepth.DataPoints) != 2 {
		t.Fatalf("queue depth points = %d, want write and commit", len(queueDepth.DataPoints))
	}
}

func assertAttribute(t *testing.T, attrs attribute.Set, key, want string) {
	t.Helper()
	got, ok := attrs.Value(attribute.Key(key))
	if !ok || got.AsString() != want {
		t.Errorf("attribute %s = %q, want %q", key, got.AsString(), want)
	}
}

func TestStorageTelemetryIsDisabledUntilRegistered(t *testing.T) {
	s := openTestStorage(t, Options{})
	if got := s.telemetry.Load(); got != nil {
		t.Fatal("storage telemetry enabled before RegisterTelemetry")
	}
}
