package selftelemetry

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func TestResourceMarksTelemetryAsInternal(t *testing.T) {
	res, err := newResource(context.Background())
	if err != nil {
		t.Fatalf("newResource: %v", err)
	}
	value, ok := res.Set().Value(attribute.Key(InternalResourceAttribute))
	if !ok || !value.AsBool() {
		t.Fatalf("%s = %v, want true", InternalResourceAttribute, value)
	}
}

func TestTracingSuppressionPropagatesThroughContext(t *testing.T) {
	ctx := SuppressTracing(context.Background())
	if !TracingSuppressed(ctx) {
		t.Fatal("TracingSuppressed = false, want true")
	}
}

func TestDurationHistogramViewMatchesOtelopSecondHistograms(t *testing.T) {
	view := durationHistogramView()
	for _, name := range []string{
		"otelop.duckdb.query.duration",
		"otelop.duckdb.write.duration",
		"otelop.storage.commit.duration",
	} {
		stream, ok := view(sdkmetric.Instrument{
			Name: name,
			Kind: sdkmetric.InstrumentKindHistogram,
			Unit: "s",
		})
		if !ok {
			t.Errorf("view did not match %q", name)
			continue
		}
		aggregation, ok := stream.Aggregation.(sdkmetric.AggregationBase2ExponentialHistogram)
		if !ok {
			t.Errorf("aggregation for %q = %T, want exponential histogram", name, stream.Aggregation)
			continue
		}
		if aggregation.MaxSize != durationHistogramMaxSize || aggregation.MaxScale != durationHistogramMaxScale {
			t.Errorf("aggregation for %q = %+v", name, aggregation)
		}
	}

	for _, instrument := range []sdkmetric.Instrument{
		{Name: "otelop.duckdb.query.duration", Kind: sdkmetric.InstrumentKindHistogram, Unit: "ms"},
		{Name: "http.server.request.duration", Kind: sdkmetric.InstrumentKindHistogram, Unit: "s"},
		{Name: "otelop.duckdb.query.duration", Kind: sdkmetric.InstrumentKindCounter, Unit: "s"},
	} {
		if _, ok := view(instrument); ok {
			t.Errorf("view unexpectedly matched %+v", instrument)
		}
	}
}

func TestDurationHistogramViewExportsExponentialHistogram(t *testing.T) {
	reader := sdkmetric.NewManualReader(
		sdkmetric.WithTemporalitySelector(selfTelemetryTemporality),
	)
	provider := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(reader),
		sdkmetric.WithView(durationHistogramView()),
	)
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })

	histogram, err := provider.Meter("test").Float64Histogram(
		"otelop.duckdb.query.duration",
		metric.WithUnit("s"),
	)
	if err != nil {
		t.Fatalf("Float64Histogram: %v", err)
	}
	histogram.Record(context.Background(), 0.006)
	histogram.Record(context.Background(), 0.076)

	var resourceMetrics metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &resourceMetrics); err != nil {
		t.Fatalf("Collect: %v", err)
	}
	data := resourceMetrics.ScopeMetrics[0].Metrics[0].Data
	exponential, ok := data.(metricdata.ExponentialHistogram[float64])
	if !ok {
		t.Fatalf("aggregation = %T, want exponential histogram", data)
	}
	if exponential.Temporality != metricdata.DeltaTemporality {
		t.Fatalf("temporality = %v, want delta", exponential.Temporality)
	}
	if len(exponential.DataPoints) != 1 || exponential.DataPoints[0].Count != 2 {
		t.Fatalf("data points = %+v, want one point with two observations", exponential.DataPoints)
	}
	if got := len(exponential.DataPoints[0].PositiveBucket.Counts); got > durationHistogramMaxSize {
		t.Fatalf("positive buckets = %d, want at most %d", got, durationHistogramMaxSize)
	}

	histogram.Record(context.Background(), 0.02)
	resourceMetrics = metricdata.ResourceMetrics{}
	if err := reader.Collect(context.Background(), &resourceMetrics); err != nil {
		t.Fatalf("second Collect: %v", err)
	}
	exponential = resourceMetrics.ScopeMetrics[0].Metrics[0].Data.(metricdata.ExponentialHistogram[float64])
	if len(exponential.DataPoints) != 1 || exponential.DataPoints[0].Count != 1 {
		t.Fatalf("second data points = %+v, want only the new observation", exponential.DataPoints)
	}
}

func TestSelfTelemetryTemporalityOnlyMakesHistogramsDelta(t *testing.T) {
	for _, kind := range []sdkmetric.InstrumentKind{
		sdkmetric.InstrumentKindCounter,
		sdkmetric.InstrumentKindUpDownCounter,
		sdkmetric.InstrumentKindObservableCounter,
		sdkmetric.InstrumentKindObservableUpDownCounter,
		sdkmetric.InstrumentKindGauge,
		sdkmetric.InstrumentKindObservableGauge,
	} {
		if got := selfTelemetryTemporality(kind); got != metricdata.CumulativeTemporality {
			t.Errorf("temporality for %v = %v, want cumulative", kind, got)
		}
	}
	if got := selfTelemetryTemporality(sdkmetric.InstrumentKindHistogram); got != metricdata.DeltaTemporality {
		t.Errorf("histogram temporality = %v, want delta", got)
	}
}
