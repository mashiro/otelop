package storage

import (
	"context"
	"math"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
)

func explicitHistogram(name string, temporality pmetric.AggregationTemporality, counts []uint64, sum, min, max float64, ts time.Time) pmetric.Metrics {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")
	metric := rm.ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
	metric.SetName(name)
	histogram := metric.SetEmptyHistogram()
	histogram.SetAggregationTemporality(temporality)
	point := histogram.DataPoints().AppendEmpty()
	point.SetCount(sumUint64(counts))
	point.SetSum(sum)
	point.SetMin(min)
	point.SetMax(max)
	point.SetTimestamp(pcommon.NewTimestampFromTime(ts))
	point.ExplicitBounds().FromRaw([]float64{10, 20})
	point.BucketCounts().FromRaw(counts)
	return md
}

func sumUint64(values []uint64) uint64 {
	var total uint64
	for _, value := range values {
		total += value
	}
	return total
}

func TestMetricDistributionStats_DeltaHistogram(t *testing.T) {
	s := openTestStorage(t, Options{})
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	s.AddMetrics(context.Background(), explicitHistogram("latency", pmetric.AggregationTemporalityDelta, []uint64{1, 2, 1}, 55, 5, 25, t0))
	s.Sync()

	stats, err := s.MetricDistributionStats(context.Background(), "svc", "latency", t0.Add(-time.Second), t0.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if stats == nil {
		t.Fatal("expected statistics")
	}
	if stats.Count != 4 || stats.Mean == nil || *stats.Mean != 13.75 {
		t.Fatalf("unexpected count/mean: %+v", stats)
	}
	if stats.Min == nil || *stats.Min != 5 || stats.Max == nil || *stats.Max != 25 {
		t.Fatalf("unexpected min/max: %+v", stats)
	}
	if stats.P50 == nil || math.Abs(*stats.P50-15) > 1e-9 {
		t.Fatalf("p50 = %v, want 15", stats.P50)
	}
}

func TestMetricDistributionStats_CumulativeUsesPredecessorAndBucketDeltas(t *testing.T) {
	s := openTestStorage(t, Options{})
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	s.AddMetrics(context.Background(), explicitHistogram("latency", pmetric.AggregationTemporalityCumulative, []uint64{1, 1, 0}, 15, 5, 15, t0))
	s.AddMetrics(context.Background(), explicitHistogram("latency", pmetric.AggregationTemporalityCumulative, []uint64{1, 3, 1}, 55, 5, 30, t0.Add(time.Second)))
	s.Sync()

	stats, err := s.MetricDistributionStats(context.Background(), "svc", "latency", t0.Add(500*time.Millisecond), t0.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if stats == nil || stats.Count != 3 || stats.Mean == nil || math.Abs(*stats.Mean-40.0/3.0) > 1e-9 {
		t.Fatalf("unexpected stats: %+v", stats)
	}
	if stats.P50 == nil || math.Abs(*stats.P50-17.5) > 1e-9 {
		t.Fatalf("p50 = %v, want 17.5", stats.P50)
	}
	if stats.Min != nil || stats.Max != nil {
		t.Fatalf("cumulative interval min/max must be unknown: %+v", stats)
	}
}

func TestMetricDistributionStats_ExponentialHistogram(t *testing.T) {
	s := openTestStorage(t, Options{})
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")
	metric := rm.ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
	metric.SetName("latency.exp")
	histogram := metric.SetEmptyExponentialHistogram()
	histogram.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
	point := histogram.DataPoints().AppendEmpty()
	point.SetTimestamp(pcommon.NewTimestampFromTime(t0))
	point.SetCount(2)
	point.SetSum(3)
	point.SetMin(1)
	point.SetMax(2)
	point.SetScale(0)
	point.Positive().SetOffset(0)
	point.Positive().BucketCounts().FromRaw([]uint64{1, 1})
	s.AddMetrics(context.Background(), md)
	s.Sync()

	stats, err := s.MetricDistributionStats(context.Background(), "svc", "latency.exp", t0.Add(-time.Second), t0.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if stats == nil || stats.P50 == nil || math.Abs(*stats.P50-2) > 1e-9 {
		t.Fatalf("unexpected exponential histogram stats: %+v", stats)
	}
}
