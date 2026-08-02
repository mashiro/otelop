package storage

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
)

// buildCumulativeSumWithAttr is buildCumulativeSum plus a single attribute,
// used to build multiple attribute-series sharing a metric name.
func buildCumulativeSumWithAttr(name, service string, v float64, ts time.Time, attrKey, attrVal string) pmetric.Metrics {
	md := buildCumulativeSum(name, service, v, ts)
	dp := md.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
	dp.Attributes().PutStr(attrKey, attrVal)
	return md
}

// buildDeltaSumWithAttrs is buildDeltaSum plus an arbitrary attribute set,
// used to build multiple attribute-series sharing a metric name.
func buildDeltaSumWithAttrs(name, service string, v float64, ts time.Time, attrs map[string]string) pmetric.Metrics {
	md := buildDeltaSum(name, service, v, ts)
	dp := md.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
	for k, v := range attrs {
		dp.Attributes().PutStr(k, v)
	}
	return md
}

func buildSumWithAttrs(name, service string, v float64, ts time.Time, temporality pmetric.AggregationTemporality, monotonic bool, attrs map[string]string) pmetric.Metrics {
	md := buildDeltaSum(name, service, v, ts)
	sum := md.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum()
	sum.SetAggregationTemporality(temporality)
	sum.SetIsMonotonic(monotonic)
	for k, v := range attrs {
		sum.DataPoints().At(0).Attributes().PutStr(k, v)
	}
	return md
}

func buildGaugeWithAttrs(name, service string, v float64, ts time.Time, attrs map[string]string) pmetric.Metrics {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", service)
	metric := rm.ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
	metric.SetName(name)
	dp := metric.SetEmptyGauge().DataPoints().AppendEmpty()
	dp.SetDoubleValue(v)
	dp.SetTimestamp(pcommon.NewTimestampFromTime(ts))
	for k, v := range attrs {
		dp.Attributes().PutStr(k, v)
	}
	return md
}

func TestMetricAggregate_Validation(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now()

	for _, tt := range []struct {
		name    string
		groupBy []string
		bucket  time.Duration
	}{
		{name: "groupBy is required", bucket: time.Minute},
		{name: "bucket cannot be negative", groupBy: []string{"region"}, bucket: -time.Second},
	} {
		t.Run(tt.name, func(t *testing.T) {
			_, err := s.MetricAggregate(ctx, "svc", "m", tt.groupBy, tt.bucket, now.Add(-time.Hour), now.Add(time.Hour))
			if err == nil {
				t.Fatal("expected an error, got nil")
			}
		})
	}
}

// TestMetricAggregate_ScalarSemantics covers the four scalar meanings
// the chart query supports. Multiple temporal samples and multiple underlying
// series deliberately land in one bucket so the test distinguishes averaging
// an instantaneous Gauge from summing interval/raw Sum values.
func TestMetricAggregate_ScalarSemantics(t *testing.T) {
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	attrs := func(worker string) map[string]string {
		return map[string]string{"region": "A", "worker": worker}
	}

	tests := []struct {
		name  string
		add   func(*Storage, context.Context)
		value float64
	}{
		{
			name: "gauge averages each series over time then sums series",
			add: func(s *Storage, ctx context.Context) {
				s.AddMetrics(ctx, buildGaugeWithAttrs("metric", "svc", 2, t0, attrs("1")))
				s.AddMetrics(ctx, buildGaugeWithAttrs("metric", "svc", 4, t0.Add(10*time.Second), attrs("1")))
				s.AddMetrics(ctx, buildGaugeWithAttrs("metric", "svc", 10, t0, attrs("2")))
				s.AddMetrics(ctx, buildGaugeWithAttrs("metric", "svc", 14, t0.Add(10*time.Second), attrs("2")))
			},
			value: 15, // avg(2,4) + avg(10,14)
		},
		{
			name: "delta monotonic sum adds every interval",
			add: func(s *Storage, ctx context.Context) {
				for _, point := range []struct {
					worker string
					offset time.Duration
					value  float64
				}{{"1", 0, 2}, {"1", 10 * time.Second, 4}, {"2", 0, 10}, {"2", 10 * time.Second, 14}} {
					s.AddMetrics(ctx, buildSumWithAttrs("metric", "svc", point.value, t0.Add(point.offset), pmetric.AggregationTemporalityDelta, true, attrs(point.worker)))
				}
			},
			value: 30,
		},
		{
			name: "cumulative monotonic sum derives each series before combining",
			add: func(s *Storage, ctx context.Context) {
				for _, point := range []struct {
					worker string
					offset time.Duration
					value  float64
				}{{"1", -time.Second, 100}, {"1", 0, 103}, {"1", 10 * time.Second, 108}, {"2", -time.Second, 1000}, {"2", 0, 1007}, {"2", 10 * time.Second, 1018}} {
					s.AddMetrics(ctx, buildSumWithAttrs("metric", "svc", point.value, t0.Add(point.offset), pmetric.AggregationTemporalityCumulative, true, attrs(point.worker)))
				}
			},
			value: 26, // (3+5) + (7+11)
		},
		{
			name: "cumulative non-monotonic sum adds raw source values",
			add: func(s *Storage, ctx context.Context) {
				for _, point := range []struct {
					worker string
					offset time.Duration
					value  float64
				}{{"1", 0, 2}, {"1", 10 * time.Second, 4}, {"2", 0, 10}, {"2", 10 * time.Second, 14}} {
					s.AddMetrics(ctx, buildSumWithAttrs("metric", "svc", point.value, t0.Add(point.offset), pmetric.AggregationTemporalityCumulative, false, attrs(point.worker)))
				}
			},
			value: 30,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := openTestStorage(t, Options{})
			ctx := context.Background()
			tt.add(s, ctx)
			s.Sync()

			out, err := s.MetricAggregate(ctx, "svc", "metric", []string{"region"}, time.Minute, t0, t0.Add(time.Minute))
			if err != nil {
				t.Fatalf("MetricAggregate: %v", err)
			}
			if len(out) != 1 || len(out[0].Points) != 1 {
				t.Fatalf("shape = %+v, want one group with one bucket", out)
			}
			point := out[0].Points[0]
			if point.Value == nil || *point.Value != tt.value {
				t.Errorf("Value = %v, want %v", point.Value, tt.value)
			}
			if point.Count != nil || point.Sum != nil {
				t.Errorf("Count/Sum = %v/%v, want nil/nil for scalar metric", point.Count, point.Sum)
			}
		})
	}
}

// TestMetricAggregate_DistributionSemantics verifies that all three
// distribution families expose the same chart contract: interval count/sum,
// their weighted mean, and only the extrema the source type actually carries.
func TestMetricAggregate_DistributionSemantics(t *testing.T) {
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name   string
		metric string
		add    func(*Storage, context.Context)
		count  float64
		sum    float64
		value  float64
		min    *float64
		max    *float64
	}{
		{
			name:   "delta histogram combines series as a weighted mean",
			metric: "histogram",
			add: func(s *Storage, ctx context.Context) {
				for _, point := range []struct {
					worker        string
					count         uint64
					sum, min, max float64
				}{{"1", 2, 6, 1, 5}, {"2", 3, 15, 2, 9}} {
					md := buildHistogram("histogram", "svc", point.count, point.sum, point.min, point.max, t0)
					h := md.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Histogram()
					h.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
					dp := h.DataPoints().At(0)
					dp.Attributes().PutStr("region", "A")
					dp.Attributes().PutStr("worker", point.worker)
					s.AddMetrics(ctx, md)
				}
			},
			count: 5,
			sum:   21,
			value: 4.2,
			min:   float64Ptr(1),
			max:   float64Ptr(9),
		},
		{
			name:   "cumulative histogram derives an interval from its predecessor",
			metric: "cumulative-histogram",
			add: func(s *Storage, ctx context.Context) {
				for _, point := range []struct {
					offset        time.Duration
					count         uint64
					sum, min, max float64
				}{{-time.Second, 10, 2.5, 0.01, 0.8}, {0, 15, 4, 0.02, 0.9}} {
					md := buildHistogram("cumulative-histogram", "svc", point.count, point.sum, point.min, point.max, t0.Add(point.offset))
					dp := md.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Histogram().DataPoints().At(0)
					dp.Attributes().PutStr("region", "A")
					s.AddMetrics(ctx, md)
				}
			},
			count: 5,
			sum:   1.5,
			value: 0.3,
			min:   float64Ptr(0.02),
			max:   float64Ptr(0.9),
		},
		{
			name:   "delta exponential histogram",
			metric: "exponential-histogram",
			add: func(s *Storage, ctx context.Context) {
				md := pmetric.NewMetrics()
				rm := md.ResourceMetrics().AppendEmpty()
				rm.Resource().Attributes().PutStr("service.name", "svc")
				metric := rm.ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
				metric.SetName("exponential-histogram")
				h := metric.SetEmptyExponentialHistogram()
				h.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
				dp := h.DataPoints().AppendEmpty()
				dp.SetTimestamp(pcommon.NewTimestampFromTime(t0))
				dp.SetCount(4)
				dp.SetSum(20)
				dp.SetMin(2)
				dp.SetMax(8)
				dp.Attributes().PutStr("region", "A")
				s.AddMetrics(ctx, md)
			},
			count: 4,
			sum:   20,
			value: 5,
			min:   float64Ptr(2),
			max:   float64Ptr(8),
		},
		{
			name:   "cumulative summary",
			metric: "summary",
			add: func(s *Storage, ctx context.Context) {
				for _, point := range []struct {
					offset time.Duration
					count  uint64
					sum    float64
				}{{-time.Second, 10, 50}, {0, 13, 71}} {
					md := pmetric.NewMetrics()
					rm := md.ResourceMetrics().AppendEmpty()
					rm.Resource().Attributes().PutStr("service.name", "svc")
					metric := rm.ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
					metric.SetName("summary")
					dp := metric.SetEmptySummary().DataPoints().AppendEmpty()
					dp.SetTimestamp(pcommon.NewTimestampFromTime(t0.Add(point.offset)))
					dp.SetCount(point.count)
					dp.SetSum(point.sum)
					dp.Attributes().PutStr("region", "A")
					s.AddMetrics(ctx, md)
				}
			},
			count: 3,
			sum:   21,
			value: 7,
		},
		{
			name:   "zero-count distribution returns a defined zero mean",
			metric: "empty-histogram",
			add: func(s *Storage, ctx context.Context) {
				md := buildHistogram("empty-histogram", "svc", 0, 0, 0, 0, t0)
				h := md.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Histogram()
				h.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
				h.DataPoints().At(0).Attributes().PutStr("region", "A")
				s.AddMetrics(ctx, md)
			},
			min: float64Ptr(0),
			max: float64Ptr(0),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := openTestStorage(t, Options{})
			ctx := context.Background()
			tt.add(s, ctx)
			s.Sync()

			out, err := s.MetricAggregate(ctx, "svc", tt.metric, []string{"region"}, time.Minute, t0, t0.Add(time.Minute))
			if err != nil {
				t.Fatalf("MetricAggregate: %v", err)
			}
			if len(out) != 1 || len(out[0].Points) != 1 {
				t.Fatalf("shape = %+v, want one group with one bucket", out)
			}
			point := out[0].Points[0]
			if point.Count == nil || *point.Count != tt.count || point.Sum == nil || *point.Sum != tt.sum {
				t.Errorf("Count/Sum = %v/%v, want %v/%v", point.Count, point.Sum, tt.count, tt.sum)
			}
			if point.Value == nil || *point.Value != tt.value {
				t.Errorf("Value = %v, want weighted mean %v", point.Value, tt.value)
			}
			assertOptionalFloat(t, "Min", point.Min, tt.min)
			assertOptionalFloat(t, "Max", point.Max, tt.max)
		})
	}
}

func TestMetricAggregate_GroupingAndScope(t *testing.T) {
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	t.Run("groups by ordered attribute tuple and represents a missing key as empty", func(t *testing.T) {
		s := openTestStorage(t, Options{})
		ctx := context.Background()
		for _, point := range []struct {
			value float64
			attrs map[string]string
		}{
			{1, map[string]string{"region": "A", "zone": "1", "worker": "x"}},
			{2, map[string]string{"region": "A", "zone": "1", "worker": "y"}},
			{4, map[string]string{"region": "A", "zone": "2"}},
			{8, map[string]string{"region": "B"}},
		} {
			s.AddMetrics(ctx, buildDeltaSumWithAttrs("reqs", "svc", point.value, t0, point.attrs))
		}
		s.Sync()

		out, err := s.MetricAggregate(ctx, "svc", "reqs", []string{"region", "zone"}, time.Minute, t0, t0.Add(time.Minute))
		if err != nil {
			t.Fatalf("MetricAggregate: %v", err)
		}
		assertAggregateGroups(t, out, []aggregateGroupWant{
			{values: []string{"A", "1"}, value: 3},
			{values: []string{"A", "2"}, value: 4},
			{values: []string{"B", ""}, value: 8},
		})
	})

	t.Run("filters by service metric and half-open time range", func(t *testing.T) {
		s := openTestStorage(t, Options{})
		ctx := context.Background()
		for _, point := range []struct {
			service, metric string
			value           float64
			ts              time.Time
		}{
			{"svc", "reqs", 1, t0},
			{"other-service", "reqs", 2, t0},
			{"svc", "other-metric", 4, t0},
			{"svc", "reqs", 8, t0.Add(-time.Nanosecond)},
			{"svc", "reqs", 16, t0.Add(time.Minute)},
		} {
			s.AddMetrics(ctx, buildDeltaSumWithAttrs(point.metric, point.service, point.value, point.ts, map[string]string{"region": "A"}))
		}
		s.Sync()

		out, err := s.MetricAggregate(ctx, "svc", "reqs", []string{"region"}, time.Minute, t0, t0.Add(time.Minute))
		if err != nil {
			t.Fatalf("MetricAggregate: %v", err)
		}
		assertAggregateGroups(t, out, []aggregateGroupWant{{values: []string{"A"}, value: 1}})
	})
}

type aggregateGroupWant struct {
	values []string
	value  float64
}

func assertAggregateGroups(t *testing.T, got []AggregateSeries, want []aggregateGroupWant) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("groups = %+v, want %+v", got, want)
	}
	for i, expected := range want {
		if len(got[i].GroupValues) != len(expected.values) {
			t.Fatalf("group %d values = %v, want %v", i, got[i].GroupValues, expected.values)
		}
		for j := range expected.values {
			if got[i].GroupValues[j] != expected.values[j] {
				t.Errorf("group %d values = %v, want %v", i, got[i].GroupValues, expected.values)
			}
		}
		if len(got[i].Points) != 1 || got[i].Points[0].Value == nil || *got[i].Points[0].Value != expected.value {
			t.Errorf("group %v points = %+v, want one point with value %v", expected.values, got[i].Points, expected.value)
		}
	}
}

func float64Ptr(value float64) *float64 {
	return &value
}

func assertOptionalFloat(t *testing.T, name string, got, want *float64) {
	t.Helper()
	if got == nil || want == nil {
		if got != nil || want != nil {
			t.Errorf("%s = %v, want %v", name, got, want)
		}
		return
	}
	if *got != *want {
		t.Errorf("%s = %v, want %v", name, *got, *want)
	}
}

func TestMetricAggregate_AutoBucket(t *testing.T) {
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	t.Run("uses actual data extent instead of a much wider query window", func(t *testing.T) {
		s := openTestStorage(t, Options{})
		ctx := context.Background()
		const points = 90
		for i := range points {
			s.AddMetrics(ctx, buildCumulativeSumWithAttr("reqs", "svc", float64(i), t0.Add(time.Duration(i)*time.Minute), "region", "A"))
		}
		s.Sync()

		out, err := s.MetricAggregate(ctx, "svc", "reqs", []string{"region"}, 0, t0.Add(-7*24*time.Hour), t0.Add(7*24*time.Hour))
		if err != nil {
			t.Fatalf("MetricAggregate: %v", err)
		}
		// The old query-window-based sizing produced only 2-4 buckets here.
		if len(out) != 1 || len(out[0].Points) <= 40 {
			t.Fatalf("output = %+v, want one group with >40 data-extent-sized buckets", out)
		}
	})

	for _, tt := range []struct {
		name   string
		metric string
		seed   bool
	}{
		{name: "single-point extent falls back to one second", metric: "reqs", seed: true},
		{name: "empty extent falls back to one second", metric: "does-not-exist"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s := openTestStorage(t, Options{})
			ctx := context.Background()
			if tt.seed {
				s.AddMetrics(ctx, buildCumulativeSumWithAttr(tt.metric, "svc", 5, t0, "region", "A"))
				s.Sync()
			}

			out, err := s.MetricAggregate(ctx, "svc", tt.metric, []string{"region"}, 0, t0.Add(-time.Hour), t0.Add(time.Hour))
			if err != nil {
				t.Fatalf("MetricAggregate: %v", err)
			}
			if len(out) != 0 {
				t.Fatalf("output = %+v, want no derived points", out)
			}
		})
	}
}

// TestMetricAggregate_SeriesMissingFromOneBucket verifies a bucket where only
// one of the two series has a point sums to just that series' value, not
// NULL — SUM must ignore the absent series' non-existent row for that bucket.
func TestMetricAggregate_SeriesMissingFromOneBucket(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildDeltaSumWithAttrs("reqs", "svc", 5, t0, map[string]string{"region": "A", "worker": "1"}))
	s.AddMetrics(ctx, buildDeltaSumWithAttrs("reqs", "svc", 3, t0, map[string]string{"region": "A", "worker": "2"}))
	// Second bucket: only worker 1 emits.
	s.AddMetrics(ctx, buildDeltaSumWithAttrs("reqs", "svc", 7, t0.Add(time.Minute), map[string]string{"region": "A", "worker": "1"}))
	s.Sync()

	out, err := s.MetricAggregate(ctx, "svc", "reqs", []string{"region"}, time.Minute, t0.Add(-time.Minute), t0.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("MetricAggregate: %v", err)
	}
	if len(out) != 1 || len(out[0].Points) != 2 {
		t.Fatalf("unexpected shape: %+v", out)
	}
	if out[0].Points[0].Value == nil || *out[0].Points[0].Value != 8 {
		t.Errorf("bucket 1 Value = %v, want 8", out[0].Points[0].Value)
	}
	if out[0].Points[1].Value == nil || *out[0].Points[1].Value != 7 {
		t.Errorf("bucket 2 Value = %v, want 7 (only worker 1's contribution, not NULL)", out[0].Points[1].Value)
	}
}

// A reset is derived independently per source series before facet aggregation;
// it must not turn the shared group's value negative or reset its sibling.
func TestMetricAggregate_CounterResetDoesNotCorruptSiblingSeries(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	buildWithRegionWorker := func(v float64, ts time.Time, worker string) pmetric.Metrics {
		md := buildCumulativeSum("reqs", "svc", v, ts)
		dp := md.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
		dp.Attributes().PutStr("region", "A")
		dp.Attributes().PutStr("worker", worker)
		return md
	}

	// worker=1: 100 -> 120 (delta 20) -> 5 (reset, raw value 5 emitted)
	s.AddMetrics(ctx, buildWithRegionWorker(100, t0, "1"))
	s.AddMetrics(ctx, buildWithRegionWorker(120, t0.Add(time.Minute), "1"))
	s.AddMetrics(ctx, buildWithRegionWorker(5, t0.Add(2*time.Minute), "1"))
	// worker=2: 50 -> 60 (delta 10) -> 70 (delta 10), never resets.
	s.AddMetrics(ctx, buildWithRegionWorker(50, t0, "2"))
	s.AddMetrics(ctx, buildWithRegionWorker(60, t0.Add(time.Minute), "2"))
	s.AddMetrics(ctx, buildWithRegionWorker(70, t0.Add(2*time.Minute), "2"))
	s.Sync()

	out, err := s.MetricAggregate(ctx, "svc", "reqs", []string{"region"}, time.Minute, t0.Add(-time.Minute), t0.Add(3*time.Minute))
	if err != nil {
		t.Fatalf("MetricAggregate: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 group (region=A), got %d: %+v", len(out), out)
	}
	pts := out[0].Points
	// Bucket 1 (t0): both series report their baseline (NULL delta) -> dropped.
	// Bucket 2 (t0+1m): worker1 delta=20, worker2 delta=10 -> sum 30.
	// Bucket 3 (t0+2m): worker1 reset emits raw 5, worker2 delta=10 -> sum 15.
	if len(pts) != 2 {
		t.Fatalf("expected 2 non-baseline buckets, got %d: %+v", len(pts), pts)
	}
	if pts[0].Value == nil || *pts[0].Value != 30 {
		t.Errorf("bucket 2 Value = %v, want 30 (20+10)", pts[0].Value)
	}
	if pts[1].Value == nil || *pts[1].Value != 15 {
		t.Errorf("bucket 3 Value = %v, want 15 (reset raw 5 + unaffected delta 10), got corrupted sum if this fails", pts[1].Value)
	}
}

func TestMetricAggregate_FixedBucketBoundaries(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	// Points 30s apart; a 60s bucket should pair them 2-per-bucket.
	s.AddMetrics(ctx, buildCumulativeSumWithAttr("reqs", "svc", 0, t0, "region", "A"))
	s.AddMetrics(ctx, buildCumulativeSumWithAttr("reqs", "svc", 1, t0.Add(30*time.Second), "region", "A"))
	s.AddMetrics(ctx, buildCumulativeSumWithAttr("reqs", "svc", 3, t0.Add(60*time.Second), "region", "A"))
	s.AddMetrics(ctx, buildCumulativeSumWithAttr("reqs", "svc", 6, t0.Add(90*time.Second), "region", "A"))
	s.Sync()

	out, err := s.MetricAggregate(ctx, "svc", "reqs", []string{"region"}, time.Minute, t0.Add(-time.Minute), t0.Add(3*time.Minute))
	if err != nil {
		t.Fatalf("MetricAggregate: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 group, got %d", len(out))
	}
	// Bucket [t0, t0+60s): baseline (NULL) + delta 1 -> sum 1.
	// Bucket [t0+60s, t0+120s): delta 2 (3-1) + delta 3 (6-3) -> sum 5.
	if len(out[0].Points) != 2 {
		t.Fatalf("expected 2 buckets, got %d: %+v", len(out[0].Points), out[0].Points)
	}
	if !out[0].Points[0].TS.Equal(t0) {
		t.Errorf("bucket 1 TS = %v, want %v", out[0].Points[0].TS, t0)
	}
	if out[0].Points[0].Value == nil || *out[0].Points[0].Value != 1 {
		t.Errorf("bucket 1 Value = %v, want 1", out[0].Points[0].Value)
	}
	if !out[0].Points[1].TS.Equal(t0.Add(60 * time.Second)) {
		t.Errorf("bucket 2 TS = %v, want %v", out[0].Points[1].TS, t0.Add(60*time.Second))
	}
	if out[0].Points[1].Value == nil || *out[0].Points[1].Value != 5 {
		t.Errorf("bucket 2 Value = %v, want 5 (2+3)", out[0].Points[1].Value)
	}
}

// The point immediately before the window contributes only as the cumulative
// counter baseline; it must not surface as an out-of-window bucket itself.
func TestMetricAggregate_WindowUsesPredecessor(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildCumulativeSumWithAttr("reqs", "svc", 1, t0, "region", "A"))
	s.AddMetrics(ctx, buildCumulativeSumWithAttr("reqs", "svc", 3, t0.Add(40*time.Minute), "region", "A"))
	s.AddMetrics(ctx, buildCumulativeSumWithAttr("reqs", "svc", 7, t0.Add(50*time.Minute), "region", "A"))
	s.Sync()

	out, err := s.MetricAggregate(ctx, "svc", "reqs", []string{"region"}, time.Minute, t0.Add(30*time.Minute), t0.Add(90*time.Minute))
	if err != nil {
		t.Fatalf("MetricAggregate: %v", err)
	}
	if len(out) != 1 || len(out[0].Points) != 2 {
		t.Fatalf("expected 1 group with 2 derived points in range, got %+v", out)
	}
	if !out[0].Points[0].TS.Equal(t0.Add(40*time.Minute)) || out[0].Points[0].Value == nil || *out[0].Points[0].Value != 2 {
		t.Errorf("first point = %+v, want t0+40m with value 2 (3-1)", out[0].Points[0])
	}
	if !out[0].Points[1].TS.Equal(t0.Add(50*time.Minute)) || out[0].Points[1].Value == nil || *out[0].Points[1].Value != 4 {
		t.Errorf("second point = %+v, want t0+50m with value 4 (7-3)", out[0].Points[1])
	}
}
