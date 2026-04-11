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

// DataPoint is one observation in a metric series. For cumulative OTLP inputs
// (monotonic Sum, Histogram, Summary, ExponentialHistogram) the numeric
// fields carry per-interval deltas so the UI can show "what happened in this
// window" instead of running totals.
//
// Value is the primary chart scalar per type: instantaneous for Gauge, delta
// for Sum, per-window mean (sum/count) for Histogram/Summary/ExponentialHistogram.
// Count/Sum/Min/Max are only set for distribution types.
type DataPoint struct {
	Timestamp  time.Time      `json:"timestamp"`
	Value      float64        `json:"value"`
	Count      *float64       `json:"count,omitempty"`
	Sum        *float64       `json:"sum,omitempty"`
	Min        *float64       `json:"min,omitempty"`
	Max        *float64       `json:"max,omitempty"`
	Attributes map[string]any `json:"attributes"`
}

// convertMetrics converts pmetric.Metrics into a slice of MetricData,
// delta-izing cumulative inputs against the given seriesStore. Tests pass a
// fresh seriesStore for determinism; Store reuses its own.
func convertMetrics(md pmetric.Metrics, series *seriesStore) []*MetricData {
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

// histogramPoint is the subset of fields shared by Histogram,
// ExponentialHistogram, and Summary data points. Having a small adapter type
// lets a single helper handle delta-ization and DataPoint construction for
// all three metric types without pulling in a generic constraint.
type histogramPoint struct {
	timestamp  time.Time
	count      uint64
	sum        float64
	hasSum     bool
	min        float64
	hasMin     bool
	max        float64
	hasMax     bool
	attributes map[string]any
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
			hp := histogramPoint{
				timestamp:  dp.Timestamp().AsTime(),
				count:      dp.Count(),
				hasSum:     dp.HasSum(),
				hasMin:     dp.HasMin(),
				hasMax:     dp.HasMax(),
				attributes: attributesToMap(dp.Attributes()),
			}
			if hp.hasSum {
				hp.sum = dp.Sum()
			}
			if hp.hasMin {
				hp.min = dp.Min()
			}
			if hp.hasMax {
				hp.max = dp.Max()
			}
			if p, ok := emitDistributionPoint(hp, m.Name(), serviceName, series, now, cumulative); ok {
				points = append(points, p)
			}
		}
	case pmetric.MetricTypeSummary:
		dps := m.Summary().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			// Summary has no temporality field; treat as cumulative so Value
			// matches Histogram semantics.
			hp := histogramPoint{
				timestamp:  dp.Timestamp().AsTime(),
				count:      dp.Count(),
				sum:        dp.Sum(),
				hasSum:     true,
				attributes: attributesToMap(dp.Attributes()),
			}
			if p, ok := emitDistributionPoint(hp, m.Name(), serviceName, series, now, true); ok {
				points = append(points, p)
			}
		}
	case pmetric.MetricTypeExponentialHistogram:
		eh := m.ExponentialHistogram()
		cumulative := eh.AggregationTemporality() == pmetric.AggregationTemporalityCumulative
		dps := eh.DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			hp := histogramPoint{
				timestamp:  dp.Timestamp().AsTime(),
				count:      dp.Count(),
				hasSum:     dp.HasSum(),
				hasMin:     dp.HasMin(),
				hasMax:     dp.HasMax(),
				attributes: attributesToMap(dp.Attributes()),
			}
			if hp.hasSum {
				hp.sum = dp.Sum()
			}
			if hp.hasMin {
				hp.min = dp.Min()
			}
			if hp.hasMax {
				hp.max = dp.Max()
			}
			if p, ok := emitDistributionPoint(hp, m.Name(), serviceName, series, now, cumulative); ok {
				points = append(points, p)
			}
		}
	}

	return points, skipped
}

// emitDistributionPoint converts one raw histogram-shaped observation into a
// DataPoint, delta-izing count/sum when cumulative and a series store is
// available. Returns ok=false when the point should be dropped (baseline /
// reset observations).
func emitDistributionPoint(hp histogramPoint, metricName, serviceName string, series *seriesStore, now time.Time, cumulative bool) (DataPoint, bool) {
	emitCount, emitSum := float64(hp.count), hp.sum
	if cumulative && series != nil {
		key := seriesKey(serviceName, metricName, hp.attributes)
		countDelta, sumDelta, ok := series.histogramDelta(key, hp.count, hp.sum, now)
		if !ok {
			return DataPoint{}, false
		}
		emitCount = float64(countDelta)
		emitSum = sumDelta
	}
	point := DataPoint{
		Timestamp:  hp.timestamp,
		Value:      histogramMean(emitCount, emitSum, hp.hasSum),
		Count:      &emitCount,
		Attributes: hp.attributes,
	}
	if hp.hasSum {
		point.Sum = floatPtr(emitSum)
	}
	// Min/Max are per-point extrema reported by the SDK; they can't be
	// delta'd so they pass through untouched.
	if hp.hasMin {
		point.Min = floatPtr(hp.min)
	}
	if hp.hasMax {
		point.Max = floatPtr(hp.max)
	}
	return point, true
}

func floatPtr(v float64) *float64 { return &v }

// histogramMean returns sum/count for the window, or 0 when the window is
// empty or the SDK omitted the sum (Count still tells the consumer whether
// anything was observed).
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
