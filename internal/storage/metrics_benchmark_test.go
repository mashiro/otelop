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

// BenchmarkMetricPointsWithPredecessorsBatchHistory mirrors the WebSocket
// broadcaster's read-back (one just-committed point per metric) against a
// growing retained history. Its cost should stay flat as history grows; a
// predecessor probe that scans every older observation made it grow
// linearly (≈14ms at 45k points, ≈209ms at 2.25M).
func BenchmarkMetricPointsWithPredecessorsBatchHistory(b *testing.B) {
	for _, pointsPerSeries := range []int{500, 5000, 25000} {
		b.Run(fmt.Sprintf("points_per_series=%d", pointsPerSeries), func(b *testing.B) {
			s, windows := seedMetricHistory(b, 45, 2, pointsPerSeries)
			b.ResetTimer()
			for range b.N {
				if _, err := s.MetricPointsWithPredecessorsBatch(context.Background(), windows); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// seedMetricHistory creates metrics × instances cumulative series observed
// every 10s, appended in timestamp order like live ingest, and returns one
// broadcast window per metric covering only its newest point.
func seedMetricHistory(b *testing.B, metrics, instances, pointsPerSeries int) (*Storage, []MetricPointWindow) {
	b.Helper()
	ctx := context.Background()
	s, err := Open(ctx, Options{Retention: 365 * 24 * time.Hour})
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() {
		if err := s.Close(); err != nil {
			b.Error(err)
		}
	})
	latest := time.Date(2026, 1, 8, 0, 0, 0, 0, time.UTC)
	windows := make([]MetricPointWindow, metrics)
	for i := range metrics {
		name := fmt.Sprintf("benchmark.metric.%02d", i)
		for j := range instances {
			s.AddMetrics(ctx, buildInstanceCumulativeSum(name, "benchmark", fmt.Sprintf("instance-%d", j), float64(pointsPerSeries), latest))
		}
		windows[i] = MetricPointWindow{ServiceName: "benchmark", MetricName: name, From: latest, To: latest.Add(time.Nanosecond)}
	}
	s.Sync()
	if _, err := s.DB().ExecContext(ctx, `
		INSERT INTO metric_points (id, series_key, ts, ingested_at, flags, value_double)
		SELECT uuid(), s.series_key, make_timestamp_ns(?::BIGINT - n * 10000000000),
			make_timestamp_ns(?::BIGINT - n * 10000000000), 0, (?::BIGINT - n)::DOUBLE
		FROM metric_series s, range(1, ?) t(n)
		ORDER BY n DESC, s.series_key`,
		latest.UnixNano(), latest.UnixNano(), pointsPerSeries, pointsPerSeries); err != nil {
		b.Fatal(err)
	}
	return s, windows
}

// BenchmarkMetricsPageHistory covers the metrics list's pointCount and
// latestValue against a growing retained history. Ranking every retained
// point for latestValue and every window point for pointCount made a
// 2.25M-point page take ≈240ms over the full retention window.
func BenchmarkMetricsPageHistory(b *testing.B) {
	for _, pointsPerSeries := range []int{500, 25000} {
		s, windows := seedMetricHistory(b, 45, 2, pointsPerSeries)
		latest := windows[0].From
		// seedMetricHistory backfills points behind the series' ingest-time
		// lifetime; widen it so every window below lists all 45 metrics.
		if _, err := s.DB().ExecContext(context.Background(),
			`UPDATE metric_series SET first_seen = ?, last_seen = ?`,
			latest.Add(-time.Duration(pointsPerSeries)*10*time.Second), latest); err != nil {
			b.Fatal(err)
		}
		for name, from := range map[string]time.Time{
			"retention": latest.Add(-8 * 24 * time.Hour),
			"recent":    latest.Add(-15 * time.Minute),
		} {
			b.Run(fmt.Sprintf("points_per_series=%d/%s", pointsPerSeries, name), func(b *testing.B) {
				for range b.N {
					items, _, err := s.MetricsPage(context.Background(), from, latest.Add(time.Hour), nil, 100)
					if err != nil {
						b.Fatal(err)
					}
					if len(items) != len(windows) {
						b.Fatalf("items = %d, want %d", len(items), len(windows))
					}
				}
			})
		}
	}
}
