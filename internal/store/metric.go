package store

import (
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

// DataPoint represents a single data point in a metric.
type DataPoint struct {
	Timestamp  time.Time      `json:"timestamp"`
	Value      float64        `json:"value"`
	Attributes map[string]any `json:"attributes"`
}

// ConvertMetrics converts pmetric.Metrics into a slice of MetricData.
func ConvertMetrics(md pmetric.Metrics) []*MetricData {
	var result []*MetricData

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
				metric := &MetricData{
					Name:        m.Name(),
					Description: m.Description(),
					Unit:        m.Unit(),
					Type:        m.Type().String(),
					ServiceName: svcName,
					Resource:    resource,
					DataPoints:  extractDataPoints(m),
					ReceivedAt:  time.Now(),
				}
				result = append(result, metric)
			}
		}
	}

	return result
}

func extractDataPoints(m pmetric.Metric) []DataPoint {
	var points []DataPoint

	switch m.Type() {
	case pmetric.MetricTypeGauge:
		dps := m.Gauge().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			points = append(points, DataPoint{
				Timestamp:  dp.Timestamp().AsTime(),
				Value:      numberValue(dp),
				Attributes: attributesToMap(dp.Attributes()),
			})
		}
	case pmetric.MetricTypeSum:
		dps := m.Sum().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			points = append(points, DataPoint{
				Timestamp:  dp.Timestamp().AsTime(),
				Value:      numberValue(dp),
				Attributes: attributesToMap(dp.Attributes()),
			})
		}
	case pmetric.MetricTypeHistogram:
		dps := m.Histogram().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			points = append(points, DataPoint{
				Timestamp:  dp.Timestamp().AsTime(),
				Value:      float64(dp.Count()),
				Attributes: attributesToMap(dp.Attributes()),
			})
		}
	case pmetric.MetricTypeSummary:
		dps := m.Summary().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			points = append(points, DataPoint{
				Timestamp:  dp.Timestamp().AsTime(),
				Value:      float64(dp.Count()),
				Attributes: attributesToMap(dp.Attributes()),
			})
		}
	case pmetric.MetricTypeExponentialHistogram:
		dps := m.ExponentialHistogram().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			points = append(points, DataPoint{
				Timestamp:  dp.Timestamp().AsTime(),
				Value:      float64(dp.Count()),
				Attributes: attributesToMap(dp.Attributes()),
			})
		}
	}

	return points
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
