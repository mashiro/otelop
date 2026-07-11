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

func TestMetricAggregate_RequiresGroupBy(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now()

	_, err := s.MetricAggregate(ctx, "svc", "m", nil, time.Minute, now.Add(-time.Hour), now.Add(time.Hour))
	if err == nil {
		t.Fatal("expected an error for empty groupBy, got nil")
	}
}

func TestMetricAggregate_RequiresNonNegativeBucket(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now()

	_, err := s.MetricAggregate(ctx, "svc", "m", []string{"region"}, -time.Second, now.Add(-time.Hour), now.Add(time.Hour))
	if err == nil {
		t.Fatal("expected an error for a negative bucket, got nil")
	}
}

// TestMetricAggregate_AutoBucketFitsDataExtent is the regression test for the
// facet-view bucketing bug: with bucket == 0 ("auto") and a query window far
// wider than the data itself (mirroring the frontend's "All" range querying
// the full retention window), the bucket width must be derived from the
// metric's actual min/max timestamp — not the query window — or ~90 minutes
// of 60s-cadence points collapse into a handful of giant buckets instead of
// the ~80+ that should come out.
func TestMetricAggregate_AutoBucketFitsDataExtent(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	const points = 90
	for i := 0; i < points; i++ {
		s.AddMetrics(ctx, buildCumulativeSumWithAttr("reqs", "svc", float64(i), t0.Add(time.Duration(i)*60*time.Second), "region", "A"))
	}
	s.Sync()

	// Query window: a week, mimicking the frontend's full-retention "All"
	// range — vastly wider than the ~80 minutes the data actually spans.
	out, err := s.MetricAggregate(ctx, "svc", "reqs", []string{"region"}, 0, t0.Add(-7*24*time.Hour), t0.Add(7*24*time.Hour))
	if err != nil {
		t.Fatalf("MetricAggregate: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 group, got %d: %+v", len(out), out)
	}
	// The very first point is a baseline (NULL delta) and gets dropped, so at
	// most points-1 buckets come out. The bug produced 2-4; a correct auto
	// bucket derived from the real ~80min extent (not the 2-week window)
	// should produce most of them.
	if n := len(out[0].Points); n <= 40 {
		t.Fatalf("expected > 40 buckets from auto-bucketing against the real data extent, got %d", n)
	}
}

// TestMetricAggregate_AutoBucketSinglePointExtent verifies a single-instant
// extent (min == max, nothing to divide) falls back to the smallest bucket
// (1s) rather than erroring or dividing by zero.
func TestMetricAggregate_AutoBucketSinglePointExtent(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	s.AddMetrics(ctx, buildCumulativeSumWithAttr("reqs", "svc", 5, t0, "region", "A"))
	s.Sync()

	out, err := s.MetricAggregate(ctx, "svc", "reqs", []string{"region"}, 0, t0.Add(-time.Hour), t0.Add(time.Hour))
	if err != nil {
		t.Fatalf("MetricAggregate: %v", err)
	}
	// The single point is a baseline (NULL delta) and gets dropped entirely —
	// this test only asserts auto-bucketing didn't error/divide-by-zero on a
	// single-instant extent.
	if len(out) != 0 {
		t.Fatalf("expected no non-baseline output, got %+v", out)
	}
}

// TestMetricAggregate_AutoBucketEmptyExtent verifies a query window with no
// matching points at all (empty extent) also falls back to 1s rather than
// erroring.
func TestMetricAggregate_AutoBucketEmptyExtent(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now()

	out, err := s.MetricAggregate(ctx, "svc", "does-not-exist", []string{"region"}, 0, now.Add(-time.Hour), now.Add(time.Hour))
	if err != nil {
		t.Fatalf("MetricAggregate: %v", err)
	}
	if len(out) != 0 {
		t.Fatalf("expected no output for an empty extent, got %+v", out)
	}
}

// TestMetricAggregate_SumsLockstepSeries is the core regression test for the
// zigzag bug: two attribute-series emitting at the SAME timestamps must sum
// into one value per timestamp, not alternate between the two raw values.
func TestMetricAggregate_SumsLockstepSeries(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	// Two delta-Sum series under the same region, emitting at the same
	// instants: worker=1 emits 5s and worker=2 emits 3s at each tick.
	s.AddMetrics(ctx, buildDeltaSumWithAttrs("reqs", "svc", 5, t0, map[string]string{"region": "A", "worker": "1"}))
	s.AddMetrics(ctx, buildDeltaSumWithAttrs("reqs", "svc", 3, t0, map[string]string{"region": "A", "worker": "2"}))
	s.AddMetrics(ctx, buildDeltaSumWithAttrs("reqs", "svc", 7, t0.Add(time.Minute), map[string]string{"region": "A", "worker": "1"}))
	s.AddMetrics(ctx, buildDeltaSumWithAttrs("reqs", "svc", 2, t0.Add(time.Minute), map[string]string{"region": "A", "worker": "2"}))
	s.Sync()

	out, err := s.MetricAggregate(ctx, "svc", "reqs", []string{"region"}, time.Minute, t0.Add(-time.Minute), t0.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("MetricAggregate: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 group (region=A), got %d: %+v", len(out), out)
	}
	if len(out[0].GroupValues) != 1 || out[0].GroupValues[0] != "A" {
		t.Fatalf("GroupValues = %v, want [A]", out[0].GroupValues)
	}
	if len(out[0].Points) != 2 {
		t.Fatalf("expected 2 buckets, got %d: %+v", len(out[0].Points), out[0].Points)
	}
	if out[0].Points[0].Value == nil || *out[0].Points[0].Value != 8 {
		t.Errorf("bucket 1 Value = %v, want 8 (5+3)", out[0].Points[0].Value)
	}
	if out[0].Points[1].Value == nil || *out[0].Points[1].Value != 9 {
		t.Errorf("bucket 2 Value = %v, want 9 (7+2)", out[0].Points[1].Value)
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

func TestMetricAggregate_GaugeSum(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	build := func(v float64, region string) pmetric.Metrics {
		md := pmetric.NewMetrics()
		rm := md.ResourceMetrics().AppendEmpty()
		rm.Resource().Attributes().PutStr("service.name", "svc")
		sm := rm.ScopeMetrics().AppendEmpty()
		m := sm.Metrics().AppendEmpty()
		m.SetName("cpu.usage")
		dp := m.SetEmptyGauge().DataPoints().AppendEmpty()
		dp.SetDoubleValue(v)
		dp.SetTimestamp(pcommon.NewTimestampFromTime(t0))
		dp.Attributes().PutStr("region", region)
		return md
	}
	s.AddMetrics(ctx, build(0.3, "A"))
	s.AddMetrics(ctx, build(0.5, "A"))
	s.Sync()

	out, err := s.MetricAggregate(ctx, "svc", "cpu.usage", []string{"region"}, time.Minute, t0.Add(-time.Minute), t0.Add(time.Minute))
	if err != nil {
		t.Fatalf("MetricAggregate: %v", err)
	}
	if len(out) != 1 || len(out[0].Points) != 1 {
		t.Fatalf("unexpected shape: %+v", out)
	}
	if out[0].Points[0].Value == nil || *out[0].Points[0].Value != 0.8 {
		t.Errorf("Value = %v, want 0.8 (0.3+0.5)", out[0].Points[0].Value)
	}
}

func TestMetricAggregate_HistogramCountSumMean(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	buildAt := func(count uint64, sum, mn, mx float64, ts time.Time, region string) pmetric.Metrics {
		md := buildHistogram("http.server.request.duration", "svc", count, sum, mn, mx, ts)
		dp := md.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Histogram().DataPoints().At(0)
		dp.Attributes().PutStr("region", region)
		return md
	}

	// Series "worker-1": baseline then a real delta at t0+1s.
	s.AddMetrics(ctx, buildAt(10, 2.5, 0.01, 0.8, t0, "A"))
	s.AddMetrics(ctx, buildAt(15, 4.0, 0.02, 0.9, t0.Add(time.Minute), "A"))
	s.Sync()

	out, err := s.MetricAggregate(ctx, "svc", "http.server.request.duration", []string{"region"}, time.Minute, t0.Add(-time.Minute), t0.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("MetricAggregate: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("expected 1 group, got %d: %+v", len(out), out)
	}
	// The baseline bucket (t0) should be dropped (all-NULL aggregate); only
	// the t0+1min bucket carries a real delta.
	if len(out[0].Points) != 1 {
		t.Fatalf("expected 1 non-baseline bucket, got %d: %+v", len(out[0].Points), out[0].Points)
	}
	p := out[0].Points[0]
	if p.Count == nil || *p.Count != 5 {
		t.Errorf("Count = %v, want 5 (15-10)", p.Count)
	}
	if p.Sum == nil || *p.Sum != 1.5 {
		t.Errorf("Sum = %v, want 1.5 (4.0-2.5)", p.Sum)
	}
	if p.Value == nil || *p.Value != 0.3 {
		t.Errorf("Value (mean) = %v, want 0.3 (1.5/5)", p.Value)
	}
	if p.Min == nil || *p.Min != 0.02 || p.Max == nil || *p.Max != 0.9 {
		t.Errorf("Min/Max = %v/%v, want 0.02/0.9", p.Min, p.Max)
	}
}

// TestMetricAggregate_CounterResetIsolatedWithinSharedGroup groups both
// series under one shared facet value and checks bucket 3 (the reset bucket)
// sums to the reset series' raw delta (5, since lag=NULL->raw... wait the
// window function treats reset as emitting the raw value directly) plus the
// unaffected series' normal delta, rather than a corrupted/negative number.
func TestMetricAggregate_CounterResetIsolatedWithinSharedGroup(t *testing.T) {
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

func TestMetricAggregate_GroupByKeyMissingFromOneSeries(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	// Series 1 has "region"; series 2 does not.
	s.AddMetrics(ctx, buildCumulativeSumWithAttr("reqs", "svc", 100, t0, "region", "A"))
	md := buildCumulativeSum("reqs", "svc", 50, t0)
	dp := md.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
	dp.Attributes().PutStr("worker", "2") // no "region" key at all
	s.AddMetrics(ctx, md)
	s.Sync()

	if _, err := s.MetricAggregate(ctx, "svc", "reqs", []string{"region"}, time.Minute, t0.Add(-time.Minute), t0.Add(time.Minute)); err != nil {
		t.Fatalf("MetricAggregate: %v", err)
	}
	// Both points above are baseline (NULL delta), so no non-empty aggregate
	// rows should be emitted at all — but the grouping itself (before HAVING
	// drops rows) must not error out on the missing key. Verify by adding a
	// second wave of points that are real deltas.
	s.AddMetrics(ctx, buildCumulativeSumWithAttr("reqs", "svc", 110, t0.Add(time.Minute), "region", "A"))
	md2 := buildCumulativeSum("reqs", "svc", 60, t0.Add(time.Minute))
	dp2 := md2.ResourceMetrics().At(0).ScopeMetrics().At(0).Metrics().At(0).Sum().DataPoints().At(0)
	dp2.Attributes().PutStr("worker", "2")
	s.AddMetrics(ctx, md2)
	s.Sync()

	out, err := s.MetricAggregate(ctx, "svc", "reqs", []string{"region"}, time.Minute, t0.Add(-time.Minute), t0.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("MetricAggregate (2nd): %v", err)
	}
	groups := map[string]float64{}
	for _, g := range out {
		for _, p := range g.Points {
			if p.Value != nil {
				groups[g.GroupValues[0]] = *p.Value
			}
		}
	}
	if v, ok := groups["A"]; !ok || v != 10 {
		t.Errorf(`group "A" Value = %v (ok=%v), want 10`, v, ok)
	}
	if v, ok := groups[""]; !ok || v != 10 {
		t.Errorf(`group "" (missing region key) Value = %v (ok=%v), want 10`, v, ok)
	}
}

func TestMetricAggregate_BucketBoundaryAlignment(t *testing.T) {
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

// TestMetricAggregate_TimeRangeFiltering verifies out-of-range points never
// contribute to a bucket. The very first point (t0) sits before the queried
// range and must be fully excluded — not just from the output but from the
// window function's lag() predecessor lookup, since metricDerivedCTE filters
// `points` before computing deltas (the same window-truncation behavior
// TestMetricPoints_TimeRangeFiltering documents for the per-point query).
// Two more points landing INSIDE the range give the in-window delta
// something real to compute, sidestepping that quirk rather than exercising
// it here.
func TestMetricAggregate_TimeRangeFiltering(t *testing.T) {
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
	if len(out) != 1 || len(out[0].Points) != 1 {
		t.Fatalf("expected 1 group with 1 point in range (the in-window baseline at t0+40m is dropped), got %+v", out)
	}
	if !out[0].Points[0].TS.Equal(t0.Add(50 * time.Minute)) {
		t.Errorf("TS = %v, want %v", out[0].Points[0].TS, t0.Add(50*time.Minute))
	}
	if out[0].Points[0].Value == nil || *out[0].Points[0].Value != 4 {
		t.Errorf("Value = %v, want 4 (7-3, the t0 baseline outside the range never contributes)", out[0].Points[0].Value)
	}
}
