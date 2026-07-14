package storage

import (
	"context"
	"math"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
)

func explicitHistogram(name string, temporality pmetric.AggregationTemporality, counts []uint64, sum, min, max float64, ts time.Time, attrs ...map[string]string) pmetric.Metrics {
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
	if len(attrs) > 0 {
		for key, value := range attrs[0] {
			point.Attributes().PutStr(key, value)
		}
	}
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

	series, err := s.MetricDistributionStats(context.Background(), "svc", "latency", nil, t0.Add(-time.Second), t0.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if len(series) != 1 {
		t.Fatal("expected statistics")
	}
	stats := &series[0].Stats
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

	series, err := s.MetricDistributionStats(context.Background(), "svc", "latency", nil, t0.Add(500*time.Millisecond), t0.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if len(series) != 1 {
		t.Fatalf("unexpected series: %+v", series)
	}
	stats := &series[0].Stats
	if stats.Count != 3 || stats.Mean == nil || math.Abs(*stats.Mean-40.0/3.0) > 1e-9 {
		t.Fatalf("unexpected stats: %+v", stats)
	}
	if stats.P50 == nil || math.Abs(*stats.P50-17.5) > 1e-9 {
		t.Fatalf("p50 = %v, want 17.5", stats.P50)
	}
	if stats.Min == nil || *stats.Min != 5 || stats.Max == nil || *stats.Max != 30 {
		t.Fatalf("cumulative min/max must reduce the points in the window: %+v", stats)
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

	series, err := s.MetricDistributionStats(context.Background(), "svc", "latency.exp", nil, t0.Add(-time.Second), t0.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if len(series) != 1 || series[0].Stats.P50 == nil || math.Abs(*series[0].Stats.P50-2) > 1e-9 {
		t.Fatalf("unexpected exponential histogram stats: %+v", series)
	}
}

func TestMetricDistributionStats_GroupsAndMergesAttributeSeries(t *testing.T) {
	s := openTestStorage(t, Options{})
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	add := func(counts []uint64, sum float64, attrs map[string]string) {
		s.AddMetrics(context.Background(), explicitHistogram("latency", pmetric.AggregationTemporalityDelta,
			counts, sum, 1, 30, t0, attrs))
	}
	add([]uint64{1, 0, 0}, 5, map[string]string{"model": "opus", "worker": "a"})
	add([]uint64{0, 1, 0}, 15, map[string]string{"model": "opus", "worker": "b"})
	add([]uint64{0, 0, 2}, 50, map[string]string{"model": "haiku", "worker": "c"})
	add([]uint64{1, 0, 0}, 4, map[string]string{"worker": "d"})
	s.Sync()

	series, err := s.MetricDistributionStats(context.Background(), "svc", "latency", []string{"model"}, t0.Add(-time.Second), t0.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if len(series) != 3 {
		t.Fatalf("groups = %+v, want (unset), haiku, opus", series)
	}
	want := map[string]struct {
		count int64
		mean  float64
	}{
		"":      {count: 1, mean: 4},
		"haiku": {count: 2, mean: 25},
		"opus":  {count: 2, mean: 10},
	}
	for _, item := range series {
		key := item.GroupValues[0]
		expected, ok := want[key]
		if !ok || item.Stats.Count != expected.count || item.Stats.Mean == nil || *item.Stats.Mean != expected.mean {
			t.Errorf("group %q = %+v, want %+v", key, item.Stats, expected)
		}
	}

	series, err = s.MetricDistributionStats(context.Background(), "svc", "latency", nil, t0.Add(-time.Second), t0.Add(time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if len(series) != 4 {
		t.Fatalf("full attribute groups = %d, want 4: %+v", len(series), series)
	}
	for _, item := range series {
		if item.Attributes == nil {
			t.Fatalf("full attribute group has no attributes: %+v", item)
		}
	}
}

func TestMetricDistributionStats_DeltaDerivesBeforeGrouping(t *testing.T) {
	s := openTestStorage(t, Options{})
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	attrsA := map[string]string{"model": "opus", "worker": "a"}
	attrsB := map[string]string{"model": "opus", "worker": "b"}
	s.AddMetrics(context.Background(), explicitHistogram("latency", pmetric.AggregationTemporalityCumulative, []uint64{1, 0, 0}, 5, 5, 5, t0, attrsA))
	s.AddMetrics(context.Background(), explicitHistogram("latency", pmetric.AggregationTemporalityCumulative, []uint64{0, 1, 0}, 15, 15, 15, t0, attrsB))
	s.AddMetrics(context.Background(), explicitHistogram("latency", pmetric.AggregationTemporalityCumulative, []uint64{2, 1, 0}, 25, 5, 15, t0.Add(time.Second), attrsA))
	s.AddMetrics(context.Background(), explicitHistogram("latency", pmetric.AggregationTemporalityCumulative, []uint64{0, 2, 1}, 40, 15, 25, t0.Add(time.Second), attrsB))
	s.Sync()

	series, err := s.MetricDistributionStats(context.Background(), "svc", "latency", []string{"model"}, t0.Add(500*time.Millisecond), t0.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if len(series) != 1 || series[0].Stats.Count != 4 || series[0].Stats.Mean == nil || *series[0].Stats.Mean != 11.25 {
		t.Fatalf("unexpected grouped cumulative stats: %+v", series)
	}
}
