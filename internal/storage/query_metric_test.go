package storage

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
)

func buildCumulativeSum(name string, service string, v float64, ts time.Time) pmetric.Metrics {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", service)
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName(name)
	sum := m.SetEmptySum()
	sum.SetIsMonotonic(true)
	sum.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	dp := sum.DataPoints().AppendEmpty()
	dp.SetDoubleValue(v)
	dp.SetTimestamp(pcommon.NewTimestampFromTime(ts))
	return md
}

func buildDeltaSum(name string, service string, v float64, ts time.Time) pmetric.Metrics {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", service)
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName(name)
	sum := m.SetEmptySum()
	sum.SetIsMonotonic(true)
	sum.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
	dp := sum.DataPoints().AppendEmpty()
	dp.SetDoubleValue(v)
	dp.SetTimestamp(pcommon.NewTimestampFromTime(ts))
	return md
}

func buildInstanceCumulativeSum(name, service, instance string, v float64, ts time.Time) pmetric.Metrics {
	md := buildCumulativeSum(name, service, v, ts)
	md.ResourceMetrics().At(0).Resource().Attributes().PutStr("service.instance.id", instance)
	return md
}

// TestMetricPoints_CumulativeSumBaselineThenDelta mirrors
// the old store package's TestConvertMetrics_CumulativeSumDeltaized, but the
// baseline observation is NOT dropped here — it's a real row with a NULL
// Value, per docs/design/duckdb-storage.md's query-time derivation. Callers
// filter the NULL rather than the row never existing.
func TestMetricPoints_CumulativeSumBaselineThenDelta(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildCumulativeSum("requests.total", "svc", 100, t0))
	s.AddMetrics(ctx, buildCumulativeSum("requests.total", "svc", 150, t0.Add(time.Second)))
	s.Sync()

	points, err := s.MetricPoints(ctx, "svc", "requests.total", t0.Add(-time.Minute), t0.Add(time.Minute))
	if err != nil {
		t.Fatalf("MetricPoints: %v", err)
	}
	if len(points) != 2 {
		t.Fatalf("expected 2 points, got %d", len(points))
	}
	if points[0].Value != nil {
		t.Errorf("baseline Value = %v, want nil", *points[0].Value)
	}
	if points[1].Value == nil || *points[1].Value != 50 {
		t.Fatalf("second point Value = %v, want 50", points[1].Value)
	}
	if points[1].Cumulative == nil || *points[1].Cumulative != 150 {
		t.Fatalf("second point Cumulative = %v, want 150", points[1].Cumulative)
	}
}

func TestMetricPoints_DerivesIndependentResourceSeriesSeparately(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildInstanceCumulativeSum("requests.total", "svc", "a", 100, t0))
	s.AddMetrics(ctx, buildInstanceCumulativeSum("requests.total", "svc", "b", 1000, t0.Add(time.Second)))
	s.AddMetrics(ctx, buildInstanceCumulativeSum("requests.total", "svc", "a", 150, t0.Add(2*time.Second)))
	s.AddMetrics(ctx, buildInstanceCumulativeSum("requests.total", "svc", "b", 1100, t0.Add(3*time.Second)))
	s.Sync()

	points, err := s.MetricPoints(ctx, "svc", "requests.total", t0.Add(-time.Minute), t0.Add(time.Minute))
	if err != nil {
		t.Fatalf("MetricPoints: %v", err)
	}
	if len(points) != 4 {
		t.Fatalf("expected 4 points, got %d", len(points))
	}
	if points[0].Value != nil || points[1].Value != nil {
		t.Fatalf("first observation of each resource must be a baseline: %v, %v", points[0].Value, points[1].Value)
	}
	if points[2].Value == nil || *points[2].Value != 50 {
		t.Fatalf("instance a delta = %v, want 50", points[2].Value)
	}
	if points[3].Value == nil || *points[3].Value != 100 {
		t.Fatalf("instance b delta = %v, want 100", points[3].Value)
	}
	if points[0].SeriesKey == 0 || points[1].SeriesKey == 0 ||
		points[0].SeriesKey != points[2].SeriesKey || points[1].SeriesKey != points[3].SeriesKey ||
		points[0].SeriesKey == points[1].SeriesKey {
		t.Fatalf("resource series identities were not preserved: %d %d %d %d",
			points[0].SeriesKey, points[1].SeriesKey, points[2].SeriesKey, points[3].SeriesKey)
	}
}

// TestMetricPoints_CounterResetEmitsRawValue documents the deliberate
// deviation from the old store package's seriesStore.numberObserve: a counter reset
// (raw value decreases) emits the raw value as-is instead of being dropped,
// per docs/design/duckdb-storage.md's illustrative SQL.
func TestMetricPoints_CounterResetEmitsRawValue(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildCumulativeSum("requests.total", "svc", 100, t0))
	s.AddMetrics(ctx, buildCumulativeSum("requests.total", "svc", 120, t0.Add(time.Second)))
	s.AddMetrics(ctx, buildCumulativeSum("requests.total", "svc", 5, t0.Add(2*time.Second))) // reset
	s.Sync()

	points, err := s.MetricPoints(ctx, "svc", "requests.total", t0.Add(-time.Minute), t0.Add(time.Minute))
	if err != nil {
		t.Fatalf("MetricPoints: %v", err)
	}
	if len(points) != 3 {
		t.Fatalf("expected 3 points (reset is emitted, not dropped), got %d", len(points))
	}
	if points[2].Value == nil || *points[2].Value != 5 {
		t.Fatalf("reset point Value = %v, want the raw value 5", points[2].Value)
	}
}

func TestMetricPoints_DeltaSumAccumulatesToCumulative(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildDeltaSum("events.count", "svc", 5, t0))
	s.AddMetrics(ctx, buildDeltaSum("events.count", "svc", 3, t0.Add(time.Second)))
	s.Sync()

	points, err := s.MetricPoints(ctx, "svc", "events.count", t0.Add(-time.Minute), t0.Add(time.Minute))
	if err != nil {
		t.Fatalf("MetricPoints: %v", err)
	}
	if len(points) != 2 {
		t.Fatalf("expected 2 points, got %d", len(points))
	}
	if points[0].Value == nil || *points[0].Value != 5 {
		t.Fatalf("first Value = %v, want 5 (delta input passes through)", points[0].Value)
	}
	if points[0].Cumulative == nil || *points[0].Cumulative != 5 {
		t.Fatalf("first Cumulative = %v, want 5", points[0].Cumulative)
	}
	if points[1].Value == nil || *points[1].Value != 3 {
		t.Fatalf("second Value = %v, want 3", points[1].Value)
	}
	if points[1].Cumulative == nil || *points[1].Cumulative != 8 {
		t.Fatalf("second Cumulative = %v, want 8", points[1].Cumulative)
	}
}

func TestMetricPointsWithPredecessors_DeltaHistogramStartsAtWindow(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, explicitHistogram("latency", pmetric.AggregationTemporalityDelta, []uint64{1, 1, 0}, 10, 1, 9, t0))
	s.AddMetrics(ctx, explicitHistogram("latency", pmetric.AggregationTemporalityDelta, []uint64{1, 1, 1}, 30, 1, 21, t0.Add(time.Hour)))
	s.AddMetrics(ctx, explicitHistogram("latency", pmetric.AggregationTemporalityDelta, []uint64{2, 1, 1}, 50, 1, 25, t0.Add(2*time.Hour)))
	s.Sync()

	from, to := t0.Add(30*time.Minute), t0.Add(3*time.Hour)
	assertWindow := func(t *testing.T, points []DerivedPoint) {
		t.Helper()
		if len(points) != 2 {
			t.Fatalf("points len = %d, want 2 window points and no delta predecessor", len(points))
		}
		for i, want := range []struct {
			count, sum float64
		}{{3, 30}, {7, 80}} {
			if points[i].CountCumulative == nil || *points[i].CountCumulative != want.count ||
				points[i].SumCumulative == nil || *points[i].SumCumulative != want.sum {
				t.Errorf("point %d cumulative = count %v sum %v, want count %v sum %v",
					i, points[i].CountCumulative, points[i].SumCumulative, want.count, want.sum)
			}
		}
	}

	t.Run("single", func(t *testing.T) {
		points, err := s.MetricPointsWithPredecessors(ctx, "svc", "latency", from, to)
		if err != nil {
			t.Fatal(err)
		}
		assertWindow(t, points)
	})
	t.Run("batch", func(t *testing.T) {
		batches, err := s.MetricPointsWithPredecessorsBatch(ctx, []MetricPointWindow{{
			ServiceName: "svc", MetricName: "latency", From: from, To: to,
		}})
		if err != nil {
			t.Fatal(err)
		}
		if len(batches) != 1 {
			t.Fatalf("batches len = %d, want 1", len(batches))
		}
		assertWindow(t, batches[0])
	})
}

func TestMetricPoints_GaugePassthrough(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName("cpu.utilization")
	dp := m.SetEmptyGauge().DataPoints().AppendEmpty()
	dp.SetDoubleValue(0.7)
	dp.SetTimestamp(pcommon.NewTimestampFromTime(t0))

	s.AddMetrics(ctx, md)
	s.Sync()

	points, err := s.MetricPoints(ctx, "svc", "cpu.utilization", t0.Add(-time.Minute), t0.Add(time.Minute))
	if err != nil {
		t.Fatalf("MetricPoints: %v", err)
	}
	if len(points) != 1 {
		t.Fatalf("expected 1 point, got %d", len(points))
	}
	if points[0].Value == nil || *points[0].Value != 0.7 {
		t.Fatalf("Value = %v, want 0.7", points[0].Value)
	}
	if points[0].Cumulative != nil {
		t.Errorf("Cumulative = %v, want nil for a gauge", *points[0].Cumulative)
	}
}

func TestMetricPoints_NonMonotonicSumPassthrough(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName("queue.depth")
	sum := m.SetEmptySum()
	sum.SetIsMonotonic(false)
	sum.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	dp := sum.DataPoints().AppendEmpty()
	dp.SetDoubleValue(42)
	dp.SetTimestamp(pcommon.NewTimestampFromTime(t0))

	s.AddMetrics(ctx, md)
	s.Sync()

	points, err := s.MetricPoints(ctx, "svc", "queue.depth", t0.Add(-time.Minute), t0.Add(time.Minute))
	if err != nil {
		t.Fatalf("MetricPoints: %v", err)
	}
	if len(points) != 1 || points[0].Value == nil || *points[0].Value != 42 {
		t.Fatalf("expected passthrough value 42, got %+v", points)
	}
	if points[0].Cumulative != nil {
		t.Errorf("Cumulative = %v, want nil for non-monotonic Sum", *points[0].Cumulative)
	}
}

func buildHistogram(name, service string, count uint64, sum, mn, mx float64, ts time.Time) pmetric.Metrics {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", service)
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName(name)
	h := m.SetEmptyHistogram()
	h.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	dp := h.DataPoints().AppendEmpty()
	dp.SetCount(count)
	dp.SetSum(sum)
	dp.SetMin(mn)
	dp.SetMax(mx)
	dp.SetTimestamp(pcommon.NewTimestampFromTime(ts))
	return md
}

// TestMetricPoints_HistogramCumulativeDeltaized mirrors the old store package's
// TestConvertMetrics_HistogramDeltaized / TestHistogramDelta_CountAndSum.
func TestMetricPoints_HistogramCumulativeDeltaized(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildHistogram("http.server.request.duration", "svc", 10, 2.5, 0.01, 0.8, t0))
	s.AddMetrics(ctx, buildHistogram("http.server.request.duration", "svc", 15, 4.0, 0.02, 0.9, t0.Add(time.Second)))
	s.Sync()

	points, err := s.MetricPoints(ctx, "svc", "http.server.request.duration", t0.Add(-time.Minute), t0.Add(time.Minute))
	if err != nil {
		t.Fatalf("MetricPoints: %v", err)
	}
	if len(points) != 2 {
		t.Fatalf("expected 2 points, got %d", len(points))
	}

	p := points[1]
	if p.Count == nil || *p.Count != 5 {
		t.Errorf("Count = %v, want 5", p.Count)
	}
	if p.Sum == nil || *p.Sum != 1.5 {
		t.Errorf("Sum = %v, want 1.5", p.Sum)
	}
	if p.CountCumulative == nil || *p.CountCumulative != 15 {
		t.Errorf("CountCumulative = %v, want 15", p.CountCumulative)
	}
	if p.SumCumulative == nil || *p.SumCumulative != 4.0 {
		t.Errorf("SumCumulative = %v, want 4.0", p.SumCumulative)
	}
	if p.Value == nil || *p.Value != 0.3 {
		t.Errorf("Value (mean) = %v, want 0.3", p.Value)
	}
	if p.Min == nil || *p.Min != 0.02 || p.Max == nil || *p.Max != 0.9 {
		t.Errorf("Min/Max = %v/%v, want 0.02/0.9 (passthrough, not delta'd)", p.Min, p.Max)
	}
}

// TestMetricPoints_TypeRidesAlongPerRow verifies DerivedPoint.Type is
// populated from the series' metric_type so a caller (FilterDerivedPoints)
// can filter baseline observations without a separate MetricSummary
// lookup — see the metricPointsQuery doc comment.
func TestMetricPoints_TypeRidesAlongPerRow(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildCumulativeSum("requests.total", "svc", 100, t0))
	s.Sync()

	points, err := s.MetricPoints(ctx, "svc", "requests.total", t0.Add(-time.Minute), t0.Add(time.Minute))
	if err != nil {
		t.Fatalf("MetricPoints: %v", err)
	}
	if len(points) != 1 || points[0].Type != "Sum" {
		t.Fatalf("Type = %q, want %q", points[0].Type, "Sum")
	}
}

func TestLatestValue_CumulativeSumReturnsMostRecentDelta(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildCumulativeSum("requests.total", "svc", 100, t0))
	s.AddMetrics(ctx, buildCumulativeSum("requests.total", "svc", 150, t0.Add(time.Second)))
	s.AddMetrics(ctx, buildCumulativeSum("requests.total", "svc", 210, t0.Add(2*time.Second)))
	s.Sync()

	v, err := s.LatestValue(ctx, "svc", "requests.total")
	if err != nil {
		t.Fatalf("LatestValue: %v", err)
	}
	if v == nil || *v != 60 {
		t.Fatalf("LatestValue = %v, want 60 (210 - 150)", v)
	}
}

// TestLatestValue_BaselineOnlyReturnsNil documents that a series with just
// one observation ever (a monotonic cumulative Sum's baseline, nothing to
// derive a delta against yet) has no meaningful latest value — mirrors
// MetricPoints/FilterDerivedPoints dropping the same row.
func TestLatestValue_BaselineOnlyReturnsNil(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildCumulativeSum("requests.total", "svc", 100, t0))
	s.Sync()

	v, err := s.LatestValue(ctx, "svc", "requests.total")
	if err != nil {
		t.Fatalf("LatestValue: %v", err)
	}
	if v != nil {
		t.Errorf("LatestValue = %v, want nil for a baseline-only series", *v)
	}
}

func TestLatestValue_GaugePassthrough(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName("cpu.utilization")
	dp := m.SetEmptyGauge().DataPoints().AppendEmpty()
	dp.SetDoubleValue(0.42)
	dp.SetTimestamp(pcommon.NewTimestampFromTime(t0))
	s.AddMetrics(ctx, md)
	s.Sync()

	v, err := s.LatestValue(ctx, "svc", "cpu.utilization")
	if err != nil {
		t.Fatalf("LatestValue: %v", err)
	}
	if v == nil || *v != 0.42 {
		t.Fatalf("LatestValue = %v, want 0.42 (gauge passthrough, no delta needed)", v)
	}
}

func TestLatestValue_HistogramMeanOfMostRecentWindow(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildHistogram("http.server.request.duration", "svc", 10, 2.5, 0.01, 0.8, t0))
	s.AddMetrics(ctx, buildHistogram("http.server.request.duration", "svc", 15, 4.0, 0.02, 0.9, t0.Add(time.Second)))
	s.Sync()

	v, err := s.LatestValue(ctx, "svc", "http.server.request.duration")
	if err != nil {
		t.Fatalf("LatestValue: %v", err)
	}
	// Same derivation as TestMetricPoints_HistogramCumulativeDeltaized's second
	// point: count_delta=5, sum_delta=1.5, mean=0.3.
	if v == nil || *v != 0.3 {
		t.Fatalf("LatestValue = %v, want 0.3", v)
	}
}

func TestMetricsPage_HistogramPointCountUsesDistributionCount(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Now().UTC()

	s.AddMetrics(ctx, buildHistogram("http.server.request.duration", "svc", 10, 2.5, 0.01, 0.8, t0))
	s.AddMetrics(ctx, buildHistogram("http.server.request.duration", "svc", 15, 4.0, 0.02, 0.9, t0.Add(time.Second)))
	s.Sync()

	items, hasNextPage, err := s.MetricsPage(ctx, t0.Add(-time.Second), t0.Add(2*time.Second), nil, 0)
	if err != nil {
		t.Fatalf("MetricsPage: %v", err)
	}
	if hasNextPage || len(items) != 1 {
		t.Fatalf("got hasNextPage=%v items=%d, want false and one histogram", hasNextPage, len(items))
	}
	// The first cumulative observation is a baseline; the second produces
	// one derived distribution window, exactly as MetricPoints does.
	if items[0].PointCount != 1 {
		t.Errorf("PointCount = %d, want 1", items[0].PointCount)
	}
}

func TestLatestValue_UnknownMetricReturnsNil(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()

	v, err := s.LatestValue(ctx, "svc", "does.not.exist")
	if err != nil {
		t.Fatalf("LatestValue: %v", err)
	}
	if v != nil {
		t.Errorf("LatestValue = %v, want nil for a nonexistent metric", *v)
	}
}

func TestMetricPoints_TimeRangeFiltering(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildCumulativeSum("m", "svc", 1, t0))
	s.AddMetrics(ctx, buildCumulativeSum("m", "svc", 2, t0.Add(time.Hour)))
	s.Sync()

	points, err := s.MetricPoints(ctx, "svc", "m", t0.Add(30*time.Minute), t0.Add(90*time.Minute))
	if err != nil {
		t.Fatalf("MetricPoints: %v", err)
	}
	if len(points) != 1 {
		t.Fatalf("expected 1 point in range, got %d", len(points))
	}
	if !points[0].TS.Equal(t0.Add(time.Hour)) {
		t.Errorf("TS = %v, want %v", points[0].TS, t0.Add(time.Hour))
	}
}

// TestMetricsPage_GroupsAcrossAttributeSeries verifies the old store's
// "group by (service, metric name), not per attribute-series" contract: two
// series sharing a metric name but with different attributes must collapse
// into one MetricSummary carrying both series_keys.
func TestMetricsPage_GroupsAcrossAttributeSeries(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now()

	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")
	rm.Resource().Attributes().PutStr("deployment.environment", "dev")
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName("http.server.request.duration")
	m.SetUnit("ms")
	gauge := m.SetEmptyGauge()
	dp1 := gauge.DataPoints().AppendEmpty()
	dp1.SetDoubleValue(1)
	dp1.SetTimestamp(pcommon.NewTimestampFromTime(now))
	dp1.Attributes().PutStr("http.route", "/a")
	dp2 := gauge.DataPoints().AppendEmpty()
	dp2.SetDoubleValue(2)
	dp2.SetTimestamp(pcommon.NewTimestampFromTime(now))
	dp2.Attributes().PutStr("http.route", "/b")

	s.AddMetrics(ctx, md)
	s.Sync()

	items, hasNextPage, err := s.MetricsPage(ctx, now.Add(-time.Hour), now.Add(time.Hour), nil, 0)
	if err != nil {
		t.Fatalf("MetricsPage: %v", err)
	}
	if hasNextPage {
		t.Fatal("hasNextPage = true for unlimited query")
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 group, got %d", len(items))
	}
	if items[0].ServiceName != "svc" || items[0].MetricName != "http.server.request.duration" {
		t.Errorf("group = %+v", items[0])
	}
	if len(items[0].SeriesKeys) != 2 {
		t.Errorf("SeriesKeys = %v, want 2 distinct attribute series", items[0].SeriesKeys)
	}
	if items[0].Resource["service.name"] != "svc" || items[0].Resource["deployment.environment"] != "dev" {
		t.Errorf("Resource = %v, want the full resource attribute map", items[0].Resource)
	}
}

// TestMetricsPage_ActiveSeriesVisibleInPastWindow is the regression test for
// the interval-overlap filter: a series whose lifetime spans the whole query
// window (first_seen before from, last_seen after to) must be returned even
// though last_seen falls outside [from, to). A last_seen-only filter would
// hide every still-active series from every past window. first_seen is
// backdated with a direct UPDATE because ingest stamps it with time.Now() —
// there is no ingest-only way to produce a lifetime that started hours ago.
func TestMetricsPage_ActiveSeriesVisibleInPastWindow(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now()

	s.AddMetrics(ctx, buildCumulativeSum("requests.total", "svc", 1, now))
	s.Sync()

	if _, err := s.DB().ExecContext(ctx,
		`UPDATE metric_series SET first_seen = ? WHERE metric_name = 'requests.total'`,
		now.Add(-2*time.Hour),
	); err != nil {
		t.Fatalf("backdate first_seen: %v", err)
	}

	// A past window strictly inside the series' lifetime: to < now <= last_seen.
	items, hasNextPage, err := s.MetricsPage(ctx, now.Add(-90*time.Minute), now.Add(-30*time.Minute), nil, 0)
	if err != nil {
		t.Fatalf("MetricsPage: %v", err)
	}
	if hasNextPage || len(items) != 1 || items[0].MetricName != "requests.total" {
		t.Fatalf("expected the still-active series in a past window, got hasNextPage=%v items=%+v", hasNextPage, items)
	}
}

func TestMetricsPage_SeriesOutsideWindowExcluded(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now()

	// Lifetime is approximately [now, now] (both stamped at write time).
	s.AddMetrics(ctx, buildCumulativeSum("requests.total", "svc", 1, now))
	s.Sync()

	for _, tc := range []struct {
		name     string
		from, to time.Time
	}{
		{name: "window entirely before lifetime", from: now.Add(-2 * time.Hour), to: now.Add(-time.Hour)},
		{name: "window entirely after lifetime", from: now.Add(time.Hour), to: now.Add(2 * time.Hour)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			items, hasNextPage, err := s.MetricsPage(ctx, tc.from, tc.to, nil, 0)
			if err != nil {
				t.Fatalf("MetricsPage: %v", err)
			}
			if hasNextPage || len(items) != 0 {
				t.Errorf("expected no series for a non-overlapping window, got hasNextPage=%v items=%+v", hasNextPage, items)
			}
		})
	}
}

func TestMetricsPage_PaginationHasNextPageAndOrdering(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now()

	for i := 0; i < 3; i++ {
		name := []string{"metric.a", "metric.b", "metric.c"}[i]
		s.AddMetrics(ctx, buildCumulativeSum(name, "svc", 1, now))
		s.Sync()
		time.Sleep(2 * time.Millisecond) // force distinct last_seen for ordering
	}

	first, _, err := s.MetricsPage(ctx, now.Add(-time.Hour), now.Add(time.Hour), nil, 1)
	if err != nil {
		t.Fatalf("MetricsPage first page: %v", err)
	}
	last := first[0]
	after := &MetricCursor{LastSeen: last.LastSeen, ServiceName: last.ServiceName, MetricName: last.MetricName}
	items, hasNextPage, err := s.MetricsPage(ctx, now.Add(-time.Hour), now.Add(time.Hour), after, 1)
	if err != nil {
		t.Fatalf("MetricsPage: %v", err)
	}
	if !hasNextPage {
		t.Fatal("hasNextPage = false, want true")
	}
	if len(items) != 1 {
		t.Fatalf("expected page of 1, got %d", len(items))
	}
	// Most-recently-active first; the cursor follows metric.c.
	if items[0].MetricName != "metric.b" {
		t.Errorf("MetricName = %q, want metric.b (order by last_seen DESC)", items[0].MetricName)
	}
}

func TestMetricsPage_EmptyPageHasNoNextPage(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now()

	for _, name := range []string{"metric.a", "metric.b", "metric.c"} {
		s.AddMetrics(ctx, buildCumulativeSum(name, "svc", 1, now))
	}
	s.Sync()

	items, hasNextPage, err := s.MetricsPage(ctx, now.Add(-time.Hour), now.Add(time.Hour), &MetricCursor{LastSeen: now.Add(-2 * time.Hour)}, 2)
	if err != nil {
		t.Fatalf("MetricsPage: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected an empty page past the end of the matching set, got %d items", len(items))
	}
	if hasNextPage {
		t.Fatal("hasNextPage = true for an empty page")
	}
}

func TestMetricsPageSearch_FiltersRenderedFields(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now()

	s.AddMetrics(ctx, buildCumulativeSum("http.requests", "frontend", 1, now))
	s.AddMetrics(ctx, buildCumulativeSum("queue.depth", "worker", 1, now))
	s.Sync()

	items, hasNextPage, err := s.MetricsPageSearch(ctx, now.Add(-time.Hour), now.Add(time.Hour), nil, 0, "FRONT")
	if err != nil {
		t.Fatalf("MetricsPageSearch: %v", err)
	}
	if hasNextPage || len(items) != 1 || items[0].MetricName != "http.requests" {
		t.Fatalf("items=%+v hasNextPage=%v, want frontend/http.requests only", items, hasNextPage)
	}
}
