package store

import (
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pmetric"
)

func TestSeriesKey_StableAcrossAttrOrder(t *testing.T) {
	a := seriesKey("svc", "m", map[string]any{"http.route": "/a", "http.method": "GET"})
	b := seriesKey("svc", "m", map[string]any{"http.method": "GET", "http.route": "/a"})
	if a != b {
		t.Fatalf("seriesKey should be order-independent, got %d vs %d", a, b)
	}
}

func TestSeriesKey_DifferentAttrsCollideNot(t *testing.T) {
	a := seriesKey("svc", "m", map[string]any{"http.route": "/a"})
	b := seriesKey("svc", "m", map[string]any{"http.route": "/b"})
	if a == b {
		t.Fatalf("different attribute values must not share a key")
	}
}

func BenchmarkSeriesKey(b *testing.B) {
	attrs := map[string]any{
		"http.method":      "GET",
		"http.route":       "/api/v1/widgets/:id",
		"http.status_code": int64(200),
		"net.peer.name":    "backend.internal",
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = seriesKey("svc", "http.server.request.duration", attrs)
	}
}

func TestNumberDelta_BaselineThenDelta(t *testing.T) {
	s := newSeriesStore()
	now := time.Unix(0, 0)
	const k uint64 = 1

	// First observation → baseline, emit nothing.
	if _, ok := s.numberDelta(k, 10, now); ok {
		t.Fatalf("first observation should be a baseline (ok=false)")
	}

	// Second observation → delta = 5.
	delta, ok := s.numberDelta(k, 15, now.Add(time.Second))
	if !ok || delta != 5 {
		t.Fatalf("expected delta=5, got delta=%v ok=%v", delta, ok)
	}

	// Third observation → delta = 3.
	delta, ok = s.numberDelta(k, 18, now.Add(2*time.Second))
	if !ok || delta != 3 {
		t.Fatalf("expected delta=3, got delta=%v ok=%v", delta, ok)
	}
}

func TestNumberDelta_ResetReestablishesBaseline(t *testing.T) {
	s := newSeriesStore()
	now := time.Unix(0, 0)
	const k uint64 = 1
	s.numberDelta(k, 100, now)
	s.numberDelta(k, 120, now.Add(time.Second))
	// Process restart / counter reset — raw value goes down.
	if _, ok := s.numberDelta(k, 5, now.Add(2*time.Second)); ok {
		t.Fatalf("reset should emit no delta")
	}
	// Next point is a delta against the new baseline.
	delta, ok := s.numberDelta(k, 8, now.Add(3*time.Second))
	if !ok || delta != 3 {
		t.Fatalf("expected delta=3 after reset, got delta=%v ok=%v", delta, ok)
	}
}

func TestHistogramDelta_CountAndSum(t *testing.T) {
	s := newSeriesStore()
	now := time.Unix(0, 0)
	const k uint64 = 1

	if _, _, ok := s.histogramDelta(k, 10, 100, now); ok {
		t.Fatalf("first observation should be baseline")
	}
	c, sm, ok := s.histogramDelta(k, 13, 130, now.Add(time.Second))
	if !ok || c != 3 || sm != 30 {
		t.Fatalf("expected count=3 sum=30, got count=%d sum=%v ok=%v", c, sm, ok)
	}
}

func TestSeriesStore_TTLPrune(t *testing.T) {
	s := newSeriesStore()
	s.ttl = time.Second
	now := time.Unix(0, 0)
	s.numberDelta(1, 1, now)
	s.numberDelta(2, 1, now.Add(10*time.Second))
	// The second write prunes anything older than 10s - 1s = 9s, which
	// includes the first entry (lastSeen=0s).
	if s.len() != 1 {
		t.Fatalf("expected stale entry to be pruned, got len=%d", s.len())
	}
}

func TestConvertMetrics_CumulativeSumDeltaized(t *testing.T) {
	s := newSeriesStore()

	// First scrape: baseline at 100. Should emit no data points.
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")
	sm := rm.ScopeMetrics().AppendEmpty()
	sum := sm.Metrics().AppendEmpty()
	sum.SetName("requests.total")
	s1 := sum.SetEmptySum()
	s1.SetIsMonotonic(true)
	s1.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	dp := s1.DataPoints().AppendEmpty()
	dp.SetIntValue(100)

	got := convertMetrics(md, s)
	if len(got) != 1 || len(got[0].DataPoints) != 0 {
		t.Fatalf("baseline scrape should produce 0 points, got metrics=%d points=%d", len(got), len(got[0].DataPoints))
	}

	// Second scrape: raw=150 → delta=50.
	md2 := pmetric.NewMetrics()
	rm2 := md2.ResourceMetrics().AppendEmpty()
	rm2.Resource().Attributes().PutStr("service.name", "svc")
	sm2 := rm2.ScopeMetrics().AppendEmpty()
	sum2 := sm2.Metrics().AppendEmpty()
	sum2.SetName("requests.total")
	s2 := sum2.SetEmptySum()
	s2.SetIsMonotonic(true)
	s2.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	dp2 := s2.DataPoints().AppendEmpty()
	dp2.SetIntValue(150)

	got = convertMetrics(md2, s)
	if len(got[0].DataPoints) != 1 {
		t.Fatalf("second scrape should produce 1 point, got %d", len(got[0].DataPoints))
	}
	if got[0].DataPoints[0].Value != 50 {
		t.Fatalf("expected delta value=50, got %v", got[0].DataPoints[0].Value)
	}
}

func TestConvertMetrics_NonMonotonicSumPassthrough(t *testing.T) {
	s := newSeriesStore()
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName("queue.depth")
	sum := m.SetEmptySum()
	sum.SetIsMonotonic(false)
	sum.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	sum.DataPoints().AppendEmpty().SetIntValue(42)

	got := convertMetrics(md, s)
	if len(got[0].DataPoints) != 1 || got[0].DataPoints[0].Value != 42 {
		t.Fatalf("non-monotonic sum should pass through unchanged, got %+v", got[0].DataPoints)
	}
}

func TestConvertMetrics_HistogramDeltaized(t *testing.T) {
	s := newSeriesStore()
	build := func(count uint64, sum float64, mn, mx float64) pmetric.Metrics {
		md := pmetric.NewMetrics()
		rm := md.ResourceMetrics().AppendEmpty()
		rm.Resource().Attributes().PutStr("service.name", "svc")
		sm := rm.ScopeMetrics().AppendEmpty()
		m := sm.Metrics().AppendEmpty()
		m.SetName("http.server.request.duration")
		h := m.SetEmptyHistogram()
		h.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
		dp := h.DataPoints().AppendEmpty()
		dp.SetCount(count)
		dp.SetSum(sum)
		dp.SetMin(mn)
		dp.SetMax(mx)
		return md
	}

	// Baseline.
	got := convertMetrics(build(10, 2.5, 0.01, 0.8), s)
	if len(got[0].DataPoints) != 0 {
		t.Fatalf("baseline histogram should emit nothing, got %d", len(got[0].DataPoints))
	}

	// Delta window: +5 requests, +1.5s total.
	got = convertMetrics(build(15, 4.0, 0.02, 0.9), s)
	if len(got[0].DataPoints) != 1 {
		t.Fatalf("expected 1 delta point, got %d", len(got[0].DataPoints))
	}
	p := got[0].DataPoints[0]
	// Value is the mean of the delta window (sum/count): 1.5 / 5 = 0.3.
	if p.Value != 0.3 {
		t.Errorf("value (mean) = %v, want 0.3", p.Value)
	}
	if p.Count == nil || *p.Count != 5 {
		t.Errorf("count = %v, want 5", p.Count)
	}
	if p.Sum == nil || *p.Sum != 1.5 {
		t.Errorf("sum = %v, want 1.5", p.Sum)
	}
	// Min/Max are per-point, not delta'd — they reflect the raw SDK values.
	if p.Min == nil || *p.Min != 0.02 {
		t.Errorf("min = %v, want 0.02", p.Min)
	}
	if p.Max == nil || *p.Max != 0.9 {
		t.Errorf("max = %v, want 0.9", p.Max)
	}
}

func TestConvertMetrics_GaugeUnaffected(t *testing.T) {
	s := newSeriesStore()
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName("cpu.utilization")
	g := m.SetEmptyGauge()
	g.DataPoints().AppendEmpty().SetDoubleValue(0.7)

	got := convertMetrics(md, s)
	if got[0].DataPoints[0].Value != 0.7 {
		t.Fatalf("gauge should pass through, got %v", got[0].DataPoints[0].Value)
	}
	if s.len() != 0 {
		t.Fatalf("gauge should not touch the series store, got len=%d", s.len())
	}
}
