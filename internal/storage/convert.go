package storage

import (
	"log/slog"
	"math"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

// ResourceRow is one row of the resources dimension table.
type ResourceRow struct {
	ResourceHash uint64
	ServiceName  string
	Attributes   map[string]any
}

// SpanEventRow is a span event. Stored as JSON inside spans.events rather
// than its own table — events are small, variable-shaped, and never queried
// independently of their parent span.
type SpanEventRow struct {
	Name       string         `json:"name"`
	Timestamp  time.Time      `json:"timestamp"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

// SpanRow is one row of the spans fact table.
type SpanRow struct {
	TraceID       string
	SpanID        string
	ParentSpanID  string
	Name          string
	Kind          string
	StartTS       time.Time
	EndTS         time.Time
	StatusCode    string
	StatusMessage string
	Attributes    map[string]any
	Events        []SpanEventRow
	ResourceHash  uint64
}

// TraceBatch is the converted output of one AddTraces call, ready to be
// enqueued to the writer.
type TraceBatch struct {
	Resources []ResourceRow
	Spans     []SpanRow
}

// MetricSeriesRow is one row of the metric_series dimension table —
// metadata that changes rarely per series (unit, description, temporality),
// as opposed to MetricPointRow's per-observation values.
type MetricSeriesRow struct {
	SeriesKey   uint64
	ServiceName string
	MetricName  string
	MetricType  string
	Unit        string
	Description string
	// Temporality is "cumulative", "delta", or "" (Gauge, where OTLP has no
	// temporality concept).
	Temporality string
	IsMonotonic bool
	Attributes  map[string]any
	// ResourceHash references the resources dimension row this series was
	// observed under, mirroring SpanRow/LogRow — full resource attributes
	// for metrics resolve through the same join.
	ResourceHash uint64
}

// MetricPointRow is one row of the metric_points fact table. It carries the
// *raw* OTLP value — no delta-ization against prior observations — because
// cumulative/delta accounting moves to query time (see docs/design). A point
// is either a scalar observation (Gauge/Sum: Value set, Count/Sum/Min/Max
// nil) or a distribution observation (Histogram/ExponentialHistogram/
// Summary: Count/Sum/Min/Max set as available, Value nil) — never both.
type MetricPointRow struct {
	ID        uuid.UUID
	SeriesKey uint64
	TS        time.Time
	StartTS   *time.Time
	Value     *float64
	Count     *float64
	Sum       *float64
	Min       *float64
	Max       *float64
}

// MetricBatch is the converted output of one AddMetrics call.
type MetricBatch struct {
	Resources []ResourceRow
	Series    []MetricSeriesRow
	Points    []MetricPointRow
}

// LogRow is one row of the logs fact table.
type LogRow struct {
	ID             uuid.UUID
	TS             time.Time
	ObservedTS     time.Time
	TraceID        string
	SpanID         string
	SeverityNumber int32
	SeverityText   string
	Body           string
	Attributes     map[string]any
	ResourceHash   uint64
}

// LogBatch is the converted output of one AddLogs call.
type LogBatch struct {
	Resources []ResourceRow
	Logs      []LogRow
}

// newRowID mints a stable identity for a fact row with no natural id of its
// own (a metric point or a log record). UUIDv7 is time-ordered, matching
// the old store package's newID, so ids sort by ingestion time.
func newRowID() uuid.UUID { return uuid.Must(uuid.NewV7()) }

// ConvertTraces converts ptrace.Traces into row batches ready for
// Storage.AddTraces. Pure function: no shared state, no I/O — the resulting
// batch can be built and tested without a Storage at all.
func ConvertTraces(td ptrace.Traces) TraceBatch {
	var batch TraceBatch
	seenResources := make(map[uint64]struct{})

	rss := td.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		rs := rss.At(i)
		attrs, svcName := resourceInfo(rs.Resource().Attributes())
		resourceHash := hashResource(attrs)
		if _, ok := seenResources[resourceHash]; !ok {
			seenResources[resourceHash] = struct{}{}
			batch.Resources = append(batch.Resources, ResourceRow{
				ResourceHash: resourceHash,
				ServiceName:  svcName,
				Attributes:   attrs,
			})
		}

		sss := rs.ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			spans := sss.At(j).Spans()
			for k := 0; k < spans.Len(); k++ {
				span := spans.At(k)
				batch.Spans = append(batch.Spans, SpanRow{
					TraceID:       span.TraceID().String(),
					SpanID:        span.SpanID().String(),
					ParentSpanID:  span.ParentSpanID().String(),
					Name:          span.Name(),
					Kind:          span.Kind().String(),
					StartTS:       span.StartTimestamp().AsTime(),
					EndTS:         span.EndTimestamp().AsTime(),
					StatusCode:    span.Status().Code().String(),
					StatusMessage: span.Status().Message(),
					Attributes:    attributesToMap(span.Attributes()),
					Events:        convertSpanEvents(span.Events()),
					ResourceHash:  resourceHash,
				})
			}
		}
	}

	return batch
}

func convertSpanEvents(events ptrace.SpanEventSlice) []SpanEventRow {
	if events.Len() == 0 {
		return nil
	}
	result := make([]SpanEventRow, 0, events.Len())
	for i := 0; i < events.Len(); i++ {
		e := events.At(i)
		result = append(result, SpanEventRow{
			Name:       e.Name(),
			Timestamp:  e.Timestamp().AsTime(),
			Attributes: attributesToMap(e.Attributes()),
		})
	}
	return result
}

// ConvertLogs converts plog.Logs into row batches ready for Storage.AddLogs.
func ConvertLogs(ld plog.Logs) LogBatch {
	var batch LogBatch
	seenResources := make(map[uint64]struct{})

	rls := ld.ResourceLogs()
	for i := 0; i < rls.Len(); i++ {
		rl := rls.At(i)
		attrs, svcName := resourceInfo(rl.Resource().Attributes())
		resourceHash := hashResource(attrs)
		if _, ok := seenResources[resourceHash]; !ok {
			seenResources[resourceHash] = struct{}{}
			batch.Resources = append(batch.Resources, ResourceRow{
				ResourceHash: resourceHash,
				ServiceName:  svcName,
				Attributes:   attrs,
			})
		}

		sls := rl.ScopeLogs()
		for j := 0; j < sls.Len(); j++ {
			records := sls.At(j).LogRecords()
			for k := 0; k < records.Len(); k++ {
				lr := records.At(k)
				batch.Logs = append(batch.Logs, LogRow{
					ID:             newRowID(),
					TS:             lr.Timestamp().AsTime(),
					ObservedTS:     lr.ObservedTimestamp().AsTime(),
					TraceID:        lr.TraceID().String(),
					SpanID:         lr.SpanID().String(),
					SeverityNumber: int32(lr.SeverityNumber()),
					SeverityText:   lr.SeverityText(),
					Body:           lr.Body().AsString(),
					Attributes:     attributesToMap(lr.Attributes()),
					ResourceHash:   resourceHash,
				})
			}
		}
	}

	return batch
}

// ConvertMetrics converts pmetric.Metrics into row batches ready for
// Storage.AddMetrics.
//
// Unlike the old store package's convertMetrics, this stores each point's *raw*
// OTLP value with no delta-ization and consults no seriesStore:
// cumulative-vs-delta accounting moves to query time (window functions over
// the temporality/is_monotonic metadata stored in MetricSeriesRow), so
// conversion here needs no per-series memory and is trivially safe to call
// concurrently or replay.
func ConvertMetrics(md pmetric.Metrics) MetricBatch {
	var batch MetricBatch
	seenSeries := make(map[uint64]struct{})
	seenResources := make(map[uint64]struct{})

	rms := md.ResourceMetrics()
	for i := 0; i < rms.Len(); i++ {
		rm := rms.At(i)
		resAttrs, svcName := resourceInfo(rm.Resource().Attributes())
		resourceHash := hashResource(resAttrs)
		if _, ok := seenResources[resourceHash]; !ok {
			seenResources[resourceHash] = struct{}{}
			batch.Resources = append(batch.Resources, ResourceRow{
				ResourceHash: resourceHash,
				ServiceName:  svcName,
				Attributes:   resAttrs,
			})
		}

		sms := rm.ScopeMetrics()
		for j := 0; j < sms.Len(); j++ {
			sm := sms.At(j)
			for k := 0; k < sm.Metrics().Len(); k++ {
				convertMetric(sm.Metrics().At(k), svcName, resourceHash, &batch, seenSeries)
			}
		}
	}

	return batch
}

// convertMetric appends one metric's series metadata (deduped by seenSeries,
// which spans the whole batch so a metric repeated across scopes in one
// OTLP payload doesn't produce duplicate dimension rows) and data points to
// batch.
func convertMetric(m pmetric.Metric, serviceName string, resourceHash uint64, batch *MetricBatch, seenSeries map[uint64]struct{}) {
	var skipped int

	addSeries := func(seriesKey uint64, attrs map[string]any, temporality string, isMonotonic bool) {
		if _, ok := seenSeries[seriesKey]; ok {
			return
		}
		seenSeries[seriesKey] = struct{}{}
		batch.Series = append(batch.Series, MetricSeriesRow{
			SeriesKey:    seriesKey,
			ServiceName:  serviceName,
			MetricName:   m.Name(),
			MetricType:   m.Type().String(),
			Unit:         m.Unit(),
			Description:  m.Description(),
			Temporality:  temporality,
			IsMonotonic:  isMonotonic,
			Attributes:   attrs,
			ResourceHash: resourceHash,
		})
	}

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
			attrs := attributesToMap(dp.Attributes())
			seriesKey := hashSeries(serviceName, m.Name(), attrs)
			addSeries(seriesKey, attrs, "", false)
			appendScalarPoint(batch, seriesKey, dp.Timestamp().AsTime(), optionalTimestamp(dp.StartTimestamp()), v)
		}
	case pmetric.MetricTypeSum:
		sum := m.Sum()
		temporality := temporalityString(sum.AggregationTemporality())
		dps := sum.DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			v := numberValue(dp)
			if math.IsNaN(v) || math.IsInf(v, 0) {
				skipped++
				continue
			}
			attrs := attributesToMap(dp.Attributes())
			seriesKey := hashSeries(serviceName, m.Name(), attrs)
			addSeries(seriesKey, attrs, temporality, sum.IsMonotonic())
			appendScalarPoint(batch, seriesKey, dp.Timestamp().AsTime(), optionalTimestamp(dp.StartTimestamp()), v)
		}
	case pmetric.MetricTypeHistogram:
		hist := m.Histogram()
		temporality := temporalityString(hist.AggregationTemporality())
		dps := hist.DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			attrs := attributesToMap(dp.Attributes())
			seriesKey := hashSeries(serviceName, m.Name(), attrs)
			addSeries(seriesKey, attrs, temporality, false)
			appendDistributionPoint(batch, seriesKey, dp.Timestamp().AsTime(), optionalTimestamp(dp.StartTimestamp()),
				float64(dp.Count()), optionalHasFloat(dp.HasSum(), dp.Sum()), optionalHasFloat(dp.HasMin(), dp.Min()), optionalHasFloat(dp.HasMax(), dp.Max()))
		}
	case pmetric.MetricTypeExponentialHistogram:
		eh := m.ExponentialHistogram()
		temporality := temporalityString(eh.AggregationTemporality())
		dps := eh.DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			attrs := attributesToMap(dp.Attributes())
			seriesKey := hashSeries(serviceName, m.Name(), attrs)
			addSeries(seriesKey, attrs, temporality, false)
			appendDistributionPoint(batch, seriesKey, dp.Timestamp().AsTime(), optionalTimestamp(dp.StartTimestamp()),
				float64(dp.Count()), optionalHasFloat(dp.HasSum(), dp.Sum()), optionalHasFloat(dp.HasMin(), dp.Min()), optionalHasFloat(dp.HasMax(), dp.Max()))
		}
	case pmetric.MetricTypeSummary:
		dps := m.Summary().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			attrs := attributesToMap(dp.Attributes())
			seriesKey := hashSeries(serviceName, m.Name(), attrs)
			// Summary has no temporality field in OTLP; treat as cumulative
			// so query-time derivation matches Histogram semantics.
			addSeries(seriesKey, attrs, "cumulative", false)
			appendDistributionPoint(batch, seriesKey, dp.Timestamp().AsTime(), optionalTimestamp(dp.StartTimestamp()),
				float64(dp.Count()), floatPtr(dp.Sum()), nil, nil)
		}
	}

	if skipped > 0 {
		slog.Warn("storage: skipped non-finite metric data points",
			"metric", m.Name(),
			"service", serviceName,
			"skipped", skipped,
		)
	}
}

// appendScalarPoint appends one Gauge/Sum observation (a plain Value, no
// Count/Sum/Min/Max) to batch.Points — shared by convertMetric's Gauge and
// Sum arms, which differ only in the series metadata (temporality/
// isMonotonic) passed to addSeries beforehand.
func appendScalarPoint(batch *MetricBatch, seriesKey uint64, ts time.Time, startTS *time.Time, value float64) {
	batch.Points = append(batch.Points, MetricPointRow{
		ID:        newRowID(),
		SeriesKey: seriesKey,
		TS:        ts,
		StartTS:   startTS,
		Value:     floatPtr(value),
	})
}

// appendDistributionPoint appends one Histogram/ExponentialHistogram/Summary
// observation (Count/Sum/Min/Max, no Value) to batch.Points — shared by
// convertMetric's three distribution-shaped arms, which differ only in how
// they populate sum/min/max (Summary has no HasSum/HasMin/HasMax concept and
// always reports Sum, never Min/Max).
func appendDistributionPoint(batch *MetricBatch, seriesKey uint64, ts time.Time, startTS *time.Time, count float64, sum, min, max *float64) {
	batch.Points = append(batch.Points, MetricPointRow{
		ID:        newRowID(),
		SeriesKey: seriesKey,
		TS:        ts,
		StartTS:   startTS,
		Count:     floatPtr(count),
		Sum:       sum,
		Min:       min,
		Max:       max,
	})
}

func temporalityString(t pmetric.AggregationTemporality) string {
	switch t {
	case pmetric.AggregationTemporalityCumulative:
		return "cumulative"
	case pmetric.AggregationTemporalityDelta:
		return "delta"
	default:
		return ""
	}
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

func floatPtr(v float64) *float64 { return &v }

func optionalHasFloat(has bool, v float64) *float64 {
	if !has {
		return nil
	}
	return &v
}

// optionalTimestamp returns nil for an unset OTLP timestamp. Many exporters
// leave StartTimestamp unset for Gauge points; pdata represents "unset" as
// the raw uint64 zero, which AsTime() converts to the Unix epoch — a
// time.Time that is NOT time.Time.IsZero() (that's Go's year-1 zero value),
// so the zero check has to happen on the pcommon.Timestamp before
// conversion. A literal 1970-01-01 start_ts in the DB would misrepresent
// "unset" as a real observation, so treat it as NULL instead.
func optionalTimestamp(ts pcommon.Timestamp) *time.Time {
	if ts == 0 {
		return nil
	}
	t := ts.AsTime()
	return &t
}
