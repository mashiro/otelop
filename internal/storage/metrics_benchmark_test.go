package storage

import (
	"context"
	"fmt"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
)

func representativeMetricPayload() pmetric.Metrics {
	// Mirrors the type/series distribution of the 845k-point development DB
	// that exposed per-series SQL upserts as the dominant ingest cost.
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "benchmark")
	rm.Resource().Attributes().PutStr("host.name", "localhost")
	sm := rm.ScopeMetrics().AppendEmpty()
	sm.Scope().SetName("benchmark.scope")
	now := pcommon.NewTimestampFromTime(time.Now())

	sumMetric := sm.Metrics().AppendEmpty()
	sumMetric.SetName("benchmark.sum")
	sum := sumMetric.SetEmptySum()
	sum.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	sum.SetIsMonotonic(true)
	for i := 0; i < 858; i++ {
		dp := sum.DataPoints().AppendEmpty()
		dp.SetTimestamp(now)
		dp.SetIntValue(int64(i))
		dp.Attributes().PutStr("series", fmt.Sprintf("sum-%d", i))
	}

	gaugeMetric := sm.Metrics().AppendEmpty()
	gaugeMetric.SetName("benchmark.gauge")
	gauge := gaugeMetric.SetEmptyGauge()
	for i := 0; i < 134; i++ {
		dp := gauge.DataPoints().AppendEmpty()
		dp.SetTimestamp(now)
		dp.SetDoubleValue(float64(i))
		dp.Attributes().PutStr("series", fmt.Sprintf("gauge-%d", i))
	}

	histMetric := sm.Metrics().AppendEmpty()
	histMetric.SetName("benchmark.histogram")
	hist := histMetric.SetEmptyHistogram()
	hist.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	bounds := []float64{0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096}
	counts := []uint64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15}
	for i := 0; i < 363; i++ {
		dp := hist.DataPoints().AppendEmpty()
		dp.SetTimestamp(now)
		dp.SetCount(120)
		dp.SetSum(1024)
		dp.ExplicitBounds().FromRaw(bounds)
		dp.BucketCounts().FromRaw(counts)
		dp.Attributes().PutStr("series", fmt.Sprintf("histogram-%d", i))
	}
	return md
}

func BenchmarkConvertMetricsRepresentative(b *testing.B) {
	md := representativeMetricPayload()
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		_ = ConvertMetrics(md)
	}
}

func BenchmarkWriteMetricsRepresentative(b *testing.B) {
	s, err := Open(context.Background(), Options{})
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() {
		if err := s.Close(); err != nil {
			b.Error(err)
		}
	})
	md := representativeMetricPayload()
	batch := ConvertMetrics(md)
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		s.writeMetrics(context.Background(), batch)
	}
}
