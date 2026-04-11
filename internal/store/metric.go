package store

import (
	"log/slog"
	"math"
	"time"

	"go.opentelemetry.io/collector/pdata/pmetric"
)

// MetricData represents a single metric with its data points.
type MetricData struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Unit        string         `json:"unit"`
	Type        string         `json:"type"`
	ServiceName string         `json:"serviceName"`
	Resource    map[string]any `json:"resource"`
	DataPoints  []DataPoint    `json:"dataPoints"`
	ReceivedAt  time.Time      `json:"receivedAt"`
}

// DataPoint represents a single data point in a metric. For cumulative-type
// metrics (monotonic Sum, Histogram, Summary, ExponentialHistogram) the
// fields carry per-interval deltas, not running totals — the store converts
// cumulative OTLP input into deltas before building this struct so the UI
// always sees "what happened in this window".
//
// Value carries the primary number to chart per metric type:
//   - Gauge: the instantaneous value
//   - Sum:   the delta (or the raw value when the exporter already emits deltas)
//   - Histogram/Summary/ExponentialHistogram: the arithmetic mean of the
//     observations in this window (sum / count). This matches the metric's
//     declared unit, unlike "count", which is dimensionless.
//
// Count/Sum/Min/Max are only set for distribution types (Histogram,
// ExponentialHistogram, Summary) so clients can render request rate, totals,
// or per-interval extrema on top of the mean.
type DataPoint struct {
	Timestamp  time.Time      `json:"timestamp"`
	Value      float64        `json:"value"`
	Count      *float64       `json:"count,omitempty"`
	Sum        *float64       `json:"sum,omitempty"`
	Min        *float64       `json:"min,omitempty"`
	Max        *float64       `json:"max,omitempty"`
	Attributes map[string]any `json:"attributes"`
}

// ConvertMetrics converts pmetric.Metrics into a slice of MetricData,
// delta-izing cumulative inputs against the given seriesStore. Pass a fresh
// seriesStore in tests to get deterministic behavior; production code should
// reuse the Store-owned instance so state survives across calls.
func ConvertMetrics(md pmetric.Metrics, series *seriesStore) []*MetricData {
	var result []*MetricData
	now := time.Now()

	for i := 0; i < md.ResourceMetrics().Len(); i++ {
		rm := md.ResourceMetrics().At(i)
		resource := attributesToMap(rm.Resource().Attributes())
		var svcName string
		if serviceName, ok := rm.Resource().Attributes().Get("service.name"); ok {
			svcName = serviceName.AsString()
		}

		for j := 0; j < rm.ScopeMetrics().Len(); j++ {
			sm := rm.ScopeMetrics().At(j)
			for k := 0; k < sm.Metrics().Len(); k++ {
				m := sm.Metrics().At(k)
				points, skipped := extractDataPoints(m, svcName, series, now)
				if skipped > 0 {
					slog.Warn("store: skipped non-finite metric data points",
						"metric", m.Name(),
						"service", svcName,
						"skipped", skipped,
					)
				}
				metric := &MetricData{
					Name:        m.Name(),
					Description: m.Description(),
					Unit:        m.Unit(),
					Type:        m.Type().String(),
					ServiceName: svcName,
					Resource:    resource,
					DataPoints:  points,
					ReceivedAt:  now,
				}
				result = append(result, metric)
			}
		}
	}

	return result
}

func extractDataPoints(m pmetric.Metric, serviceName string, series *seriesStore, now time.Time) (points []DataPoint, skipped int) {
	switch m.Type() {
	case pmetric.MetricTypeGauge:
		dps := m.Gauge().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			v := numberValue(dp)
			if math.IsNaN(v) || math.IsInf(v, 0) {
				skipped++
				continue
			}
			points = append(points, DataPoint{
				Timestamp:  dp.Timestamp().AsTime(),
				Value:      v,
				Attributes: attributesToMap(dp.Attributes()),
			})
		}
	case pmetric.MetricTypeSum:
		sum := m.Sum()
		cumulative := sum.AggregationTemporality() == pmetric.AggregationTemporalityCumulative
		dps := sum.DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			v := numberValue(dp)
			if math.IsNaN(v) || math.IsInf(v, 0) {
				skipped++
				continue
			}
			attrs := attributesToMap(dp.Attributes())
			if cumulative && sum.IsMonotonic() && series != nil {
				key := seriesKey(serviceName, m.Name(), attrs)
				delta, ok := series.numberDelta(key, v, now)
				if !ok {
					// Baseline or reset — drop the point so charts don't
					// show the cumulative value or a negative spike.
					continue
				}
				v = delta
			}
			points = append(points, DataPoint{
				Timestamp:  dp.Timestamp().AsTime(),
				Value:      v,
				Attributes: attrs,
			})
		}
	case pmetric.MetricTypeHistogram:
		hist := m.Histogram()
		cumulative := hist.AggregationTemporality() == pmetric.AggregationTemporalityCumulative
		dps := hist.DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			attrs := attributesToMap(dp.Attributes())
			count := dp.Count()
			var rawSum float64
			if dp.HasSum() {
				rawSum = dp.Sum()
			}
			emitCount, emitSum := float64(count), rawSum
			if cumulative && series != nil {
				key := seriesKey(serviceName, m.Name(), attrs)
				countDelta, sumDelta, ok := series.histogramDelta(key, count, rawSum, now)
				if !ok {
					continue
				}
				emitCount = float64(countDelta)
				emitSum = sumDelta
			}
			point := DataPoint{
				Timestamp:  dp.Timestamp().AsTime(),
				Value:      histogramMean(emitCount, emitSum, dp.HasSum()),
				Count:      &emitCount,
				Attributes: attrs,
			}
			if dp.HasSum() {
				s := emitSum
				point.Sum = &s
			}
			// Min/Max are per-point extrema in OTLP and can't be delta'd;
			// pass them through as-is so clients see the observation range
			// reported by the SDK for this window.
			if dp.HasMin() {
				point.Min = floatPtr(dp.Min())
			}
			if dp.HasMax() {
				point.Max = floatPtr(dp.Max())
			}
			points = append(points, point)
		}
	case pmetric.MetricTypeSummary:
		dps := m.Summary().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			attrs := attributesToMap(dp.Attributes())
			count := dp.Count()
			rawSum := dp.Sum()
			emitCount, emitSum := float64(count), rawSum
			// Summary has no temporality field in OTLP; treat it as
			// cumulative-ish so Value matches Histogram semantics.
			if series != nil {
				key := seriesKey(serviceName, m.Name(), attrs)
				countDelta, sumDelta, ok := series.histogramDelta(key, count, rawSum, now)
				if !ok {
					continue
				}
				emitCount = float64(countDelta)
				emitSum = sumDelta
			}
			points = append(points, DataPoint{
				Timestamp:  dp.Timestamp().AsTime(),
				Value:      histogramMean(emitCount, emitSum, true),
				Count:      &emitCount,
				Sum:        &emitSum,
				Attributes: attrs,
			})
		}
	case pmetric.MetricTypeExponentialHistogram:
		eh := m.ExponentialHistogram()
		cumulative := eh.AggregationTemporality() == pmetric.AggregationTemporalityCumulative
		dps := eh.DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			attrs := attributesToMap(dp.Attributes())
			count := dp.Count()
			var rawSum float64
			if dp.HasSum() {
				rawSum = dp.Sum()
			}
			emitCount, emitSum := float64(count), rawSum
			if cumulative && series != nil {
				key := seriesKey(serviceName, m.Name(), attrs)
				countDelta, sumDelta, ok := series.histogramDelta(key, count, rawSum, now)
				if !ok {
					continue
				}
				emitCount = float64(countDelta)
				emitSum = sumDelta
			}
			point := DataPoint{
				Timestamp:  dp.Timestamp().AsTime(),
				Value:      histogramMean(emitCount, emitSum, dp.HasSum()),
				Count:      &emitCount,
				Attributes: attrs,
			}
			if dp.HasSum() {
				s := emitSum
				point.Sum = &s
			}
			if dp.HasMin() {
				point.Min = floatPtr(dp.Min())
			}
			if dp.HasMax() {
				point.Max = floatPtr(dp.Max())
			}
			points = append(points, point)
		}
	}

	return points, skipped
}

func floatPtr(v float64) *float64 { return &v }

// histogramMean returns sum/count as the primary chart scalar for
// distribution metrics. When the window had no observations or the SDK
// omitted the sum, it returns 0 so consumers can render a zero instead of
// NaN — the companion Count field still tells them "nothing happened here".
func histogramMean(count, sum float64, hasSum bool) float64 {
	if !hasSum || count <= 0 {
		return 0
	}
	return sum / count
}

func numberValue(dp pmetric.NumberDataPoint) float64 {
	switch dp.ValueType() {
	case pmetric.NumberDataPointValueTypeInt:
		return float64(dp.IntValue())
	case pmetric.NumberDataPointValueTypeDouble:
		return dp.DoubleValue()
	default:
		return 0
	}
}
