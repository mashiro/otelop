package storage

import (
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

// ResourceRow is one row of the resources dimension table.
type ResourceRow struct {
	ResourceHash           uint64
	ServiceName            string
	SchemaURL              string
	DroppedAttributesCount uint32
	Attributes             map[string]any
	AttributesRaw          []byte
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

// TraceBatch carries converted trace rows through the write path. Storage
// fills Summaries from the transactionally updated derived table and exposes
// them to the broadcast path only after the span write commits. ConvertTraces
// leaves them empty.
type TraceBatch struct {
	Resources       []ResourceRow
	Spans           []SpanRow
	Summaries       []TraceSummary
	DroppedTraceIDs []string
}

// MetricSeriesRow is one row of the metric_series dimension table —
// metadata that changes rarely per series (unit, description, temporality),
// as opposed to MetricPointRow's per-observation values.
type MetricSeriesRow struct {
	SeriesKey   uint64
	ServiceName string
	MetricName  string
	MetricType  string
	NumberKind  string
	Unit        string
	Description string
	// Temporality is "cumulative", "delta", or "" (Gauge, where OTLP has no
	// temporality concept).
	Temporality   string
	IsMonotonic   bool
	Attributes    map[string]any
	AttributesRaw []byte
	// Scope fields preserve the instrumentation-scope identity included in
	// SeriesKey so otherwise identical dimension rows remain inspectable.
	ScopeName                   string
	ScopeVersion                string
	ScopeSchemaURL              string
	ScopeDroppedAttributesCount uint32
	ScopeAttributes             map[string]any
	ScopeAttributesRaw          []byte
	// ResourceHash references the resources dimension row this series was
	// observed under, mirroring SpanRow/LogRow — full resource attributes
	// for metrics resolve through the same join.
	ResourceHash uint64
}

// MetricPointRow is one row of the metric_points fact table. It carries the
// *raw* OTLP value — no delta-ization against prior observations — because
// cumulative/delta accounting moves to query time (see docs/design). A point
// is either a scalar observation (Gauge/Sum: exactly one of ValueInt and
// ValueDouble set, Count/Sum/Min/Max nil) or a distribution observation
// (Histogram/ExponentialHistogram/Summary: Count/Sum/Min/Max set as
// available, scalar value arms nil) — never both.
type MetricPointRow struct {
	ID                    uuid.UUID
	SeriesKey             uint64
	TS                    time.Time
	StartTS               *time.Time
	Flags                 uint32
	ValueInt              *int64
	ValueDouble           *float64
	Count                 *uint64
	Sum                   *float64
	Min                   *float64
	Max                   *float64
	HistogramLayoutHash   *uint64
	BucketCounts          []uint64
	ZeroCount             *uint64
	PositiveOffset        *int32
	PositiveBucketCounts  []uint64
	NegativeOffset        *int32
	NegativeBucketCounts  []uint64
	SummaryQuantiles      []float64
	SummaryQuantileValues []float64
}

type MetricExemplarRow struct {
	ID                    uuid.UUID
	PointID               uuid.UUID
	TS                    time.Time
	TraceID               string
	SpanID                string
	FilteredAttributes    map[string]any
	FilteredAttributesRaw []byte
	ValueInt              *int64
	ValueDouble           *float64
}

// HistogramLayoutRow is the shape shared by histogram points. Explicit
// bounds and exponential histogram scale/zero-threshold are stable for a
// configured instrument, so storing them once avoids repeating the layout
// alongside every point's counts.
type HistogramLayoutRow struct {
	LayoutHash     uint64
	Kind           string
	ExplicitBounds []float64
	Scale          *int32
	ZeroThreshold  *float64
}

// MetricBatch is the converted output of one AddMetrics call.
type MetricBatch struct {
	Resources        []ResourceRow
	Series           []MetricSeriesRow
	HistogramLayouts []HistogramLayoutRow
	Points           []MetricPointRow
	Exemplars        []MetricExemplarRow
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
		schemaURL := rs.SchemaUrl()
		resource := rs.Resource()
		attrs, svcName := resourceInfo(resource.Attributes())
		attrsRaw := encodeOTLPAttributes(resource.Attributes())
		resourceHash := hashResource(schemaURL, resource.DroppedAttributesCount(), attrsRaw)
		if _, ok := seenResources[resourceHash]; !ok {
			seenResources[resourceHash] = struct{}{}
			batch.Resources = append(batch.Resources, ResourceRow{
				ResourceHash:           resourceHash,
				ServiceName:            svcName,
				SchemaURL:              schemaURL,
				DroppedAttributesCount: resource.DroppedAttributesCount(),
				Attributes:             attrs,
				AttributesRaw:          attrsRaw,
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
		schemaURL := rl.SchemaUrl()
		resource := rl.Resource()
		attrs, svcName := resourceInfo(resource.Attributes())
		attrsRaw := encodeOTLPAttributes(resource.Attributes())
		resourceHash := hashResource(schemaURL, resource.DroppedAttributesCount(), attrsRaw)
		if _, ok := seenResources[resourceHash]; !ok {
			seenResources[resourceHash] = struct{}{}
			batch.Resources = append(batch.Resources, ResourceRow{
				ResourceHash:           resourceHash,
				ServiceName:            svcName,
				SchemaURL:              schemaURL,
				DroppedAttributesCount: resource.DroppedAttributesCount(),
				Attributes:             attrs,
				AttributesRaw:          attrsRaw,
			})
		}

		sls := rl.ScopeLogs()
		for j := 0; j < sls.Len(); j++ {
			records := sls.At(j).LogRecords()
			for k := 0; k < records.Len(); k++ {
				lr := records.At(k)
				timestamp := lr.Timestamp()
				if timestamp == 0 {
					timestamp = lr.ObservedTimestamp()
				}
				batch.Logs = append(batch.Logs, LogRow{
					ID:             newRowID(),
					TS:             timestamp.AsTime(),
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
	seenLayouts := make(map[uint64]struct{})

	rms := md.ResourceMetrics()
	for i := 0; i < rms.Len(); i++ {
		rm := rms.At(i)
		schemaURL := rm.SchemaUrl()
		resource := rm.Resource()
		resAttrs, svcName := resourceInfo(resource.Attributes())
		resAttrsRaw := encodeOTLPAttributes(resource.Attributes())
		resourceHash := hashResource(schemaURL, resource.DroppedAttributesCount(), resAttrsRaw)
		if _, ok := seenResources[resourceHash]; !ok {
			seenResources[resourceHash] = struct{}{}
			batch.Resources = append(batch.Resources, ResourceRow{
				ResourceHash:           resourceHash,
				ServiceName:            svcName,
				SchemaURL:              schemaURL,
				DroppedAttributesCount: resource.DroppedAttributesCount(),
				Attributes:             resAttrs,
				AttributesRaw:          resAttrsRaw,
			})
		}

		sms := rm.ScopeMetrics()
		for j := 0; j < sms.Len(); j++ {
			sm := sms.At(j)
			scope := sm.Scope()
			scopeIdentity := metricScopeIdentity{
				SchemaURL:              sm.SchemaUrl(),
				Name:                   scope.Name(),
				Version:                scope.Version(),
				DroppedAttributesCount: scope.DroppedAttributesCount(),
				Attributes:             attributesToMap(scope.Attributes()),
				AttributesRaw:          encodeOTLPAttributes(scope.Attributes()),
			}
			for k := 0; k < sm.Metrics().Len(); k++ {
				convertMetric(sm.Metrics().At(k), svcName, resourceHash, scopeIdentity, &batch, seenSeries, seenLayouts)
			}
		}
	}

	return batch
}

// convertMetric appends one metric's series metadata (deduped by seenSeries,
// which spans the whole batch so an identical resource/scope series repeated
// in one OTLP payload doesn't produce duplicate dimension rows) and data
// points to batch.
func convertMetric(m pmetric.Metric, serviceName string, resourceHash uint64, scope metricScopeIdentity, batch *MetricBatch, seenSeries map[uint64]struct{}, seenLayouts map[uint64]struct{}) {
	seriesKeyFor := func(attrsRaw []byte, numberKind, temporality string, isMonotonic bool) uint64 {
		return hashSeries(metricSeriesIdentity{
			ResourceHash:  resourceHash,
			Scope:         scope,
			MetricName:    m.Name(),
			MetricType:    m.Type().String(),
			NumberKind:    numberKind,
			Unit:          m.Unit(),
			Temporality:   temporality,
			IsMonotonic:   isMonotonic,
			AttributesRaw: attrsRaw,
		})
	}

	addSeries := func(seriesKey uint64, attrs map[string]any, attrsRaw []byte, numberKind, temporality string, isMonotonic bool) {
		if _, ok := seenSeries[seriesKey]; ok {
			return
		}
		seenSeries[seriesKey] = struct{}{}
		batch.Series = append(batch.Series, MetricSeriesRow{
			SeriesKey:                   seriesKey,
			ServiceName:                 serviceName,
			MetricName:                  m.Name(),
			MetricType:                  m.Type().String(),
			NumberKind:                  numberKind,
			Unit:                        m.Unit(),
			Description:                 m.Description(),
			Temporality:                 temporality,
			IsMonotonic:                 isMonotonic,
			Attributes:                  attrs,
			AttributesRaw:               attrsRaw,
			ScopeName:                   scope.Name,
			ScopeVersion:                scope.Version,
			ScopeSchemaURL:              scope.SchemaURL,
			ScopeDroppedAttributesCount: scope.DroppedAttributesCount,
			ScopeAttributes:             scope.Attributes,
			ScopeAttributesRaw:          scope.AttributesRaw,
			ResourceHash:                resourceHash,
		})
	}

	switch m.Type() {
	case pmetric.MetricTypeGauge:
		dps := m.Gauge().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			valueInt, valueDouble, numberKind := numberValue(dp)
			attrs := attributesToMap(dp.Attributes())
			attrsRaw := encodeOTLPAttributes(dp.Attributes())
			seriesKey := seriesKeyFor(attrsRaw, numberKind, "", false)
			addSeries(seriesKey, attrs, attrsRaw, numberKind, "", false)
			point := appendScalarPoint(batch, seriesKey, dp.Timestamp().AsTime(), optionalTimestamp(dp.StartTimestamp()), uint32(dp.Flags()), valueInt, valueDouble)
			appendExemplars(batch, point.ID, dp.Exemplars())
		}
	case pmetric.MetricTypeSum:
		sum := m.Sum()
		temporality := temporalityString(sum.AggregationTemporality())
		dps := sum.DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			valueInt, valueDouble, numberKind := numberValue(dp)
			attrs := attributesToMap(dp.Attributes())
			attrsRaw := encodeOTLPAttributes(dp.Attributes())
			seriesKey := seriesKeyFor(attrsRaw, numberKind, temporality, sum.IsMonotonic())
			addSeries(seriesKey, attrs, attrsRaw, numberKind, temporality, sum.IsMonotonic())
			point := appendScalarPoint(batch, seriesKey, dp.Timestamp().AsTime(), optionalTimestamp(dp.StartTimestamp()), uint32(dp.Flags()), valueInt, valueDouble)
			appendExemplars(batch, point.ID, dp.Exemplars())
		}
	case pmetric.MetricTypeHistogram:
		hist := m.Histogram()
		temporality := temporalityString(hist.AggregationTemporality())
		dps := hist.DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			bounds := append([]float64(nil), dp.ExplicitBounds().AsRaw()...)
			layout := HistogramLayoutRow{Kind: "explicit", ExplicitBounds: bounds}
			layout.LayoutHash = hashHistogramLayout(layout)
			appendHistogramLayout(batch, layout, seenLayouts)
			attrs := attributesToMap(dp.Attributes())
			attrsRaw := encodeOTLPAttributes(dp.Attributes())
			seriesKey := seriesKeyFor(attrsRaw, "", temporality, false)
			addSeries(seriesKey, attrs, attrsRaw, "", temporality, false)
			point := appendDistributionPoint(batch, seriesKey, dp.Timestamp().AsTime(), optionalTimestamp(dp.StartTimestamp()), uint32(dp.Flags()),
				dp.Count(), optionalHasFloat(dp.HasSum(), dp.Sum()), optionalHasFloat(dp.HasMin(), dp.Min()), optionalHasFloat(dp.HasMax(), dp.Max()))
			point.HistogramLayoutHash = uint64Ptr(layout.LayoutHash)
			point.BucketCounts = append([]uint64(nil), dp.BucketCounts().AsRaw()...)
			appendExemplars(batch, point.ID, dp.Exemplars())
		}
	case pmetric.MetricTypeExponentialHistogram:
		eh := m.ExponentialHistogram()
		temporality := temporalityString(eh.AggregationTemporality())
		dps := eh.DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			scale := dp.Scale()
			zeroThreshold := dp.ZeroThreshold()
			layout := HistogramLayoutRow{Kind: "exponential", Scale: &scale, ZeroThreshold: &zeroThreshold}
			layout.LayoutHash = hashHistogramLayout(layout)
			appendHistogramLayout(batch, layout, seenLayouts)
			attrs := attributesToMap(dp.Attributes())
			attrsRaw := encodeOTLPAttributes(dp.Attributes())
			seriesKey := seriesKeyFor(attrsRaw, "", temporality, false)
			addSeries(seriesKey, attrs, attrsRaw, "", temporality, false)
			point := appendDistributionPoint(batch, seriesKey, dp.Timestamp().AsTime(), optionalTimestamp(dp.StartTimestamp()), uint32(dp.Flags()),
				dp.Count(), optionalHasFloat(dp.HasSum(), dp.Sum()), optionalHasFloat(dp.HasMin(), dp.Min()), optionalHasFloat(dp.HasMax(), dp.Max()))
			point.HistogramLayoutHash = uint64Ptr(layout.LayoutHash)
			zeroCount := dp.ZeroCount()
			positiveOffset := dp.Positive().Offset()
			negativeOffset := dp.Negative().Offset()
			point.ZeroCount = &zeroCount
			point.PositiveOffset = &positiveOffset
			point.PositiveBucketCounts = append([]uint64(nil), dp.Positive().BucketCounts().AsRaw()...)
			point.NegativeOffset = &negativeOffset
			point.NegativeBucketCounts = append([]uint64(nil), dp.Negative().BucketCounts().AsRaw()...)
			appendExemplars(batch, point.ID, dp.Exemplars())
		}
	case pmetric.MetricTypeSummary:
		dps := m.Summary().DataPoints()
		for i := 0; i < dps.Len(); i++ {
			dp := dps.At(i)
			attrs := attributesToMap(dp.Attributes())
			attrsRaw := encodeOTLPAttributes(dp.Attributes())
			seriesKey := seriesKeyFor(attrsRaw, "", "cumulative", false)
			// Summary has no temporality field in OTLP; treat as cumulative
			// so query-time derivation matches Histogram semantics.
			addSeries(seriesKey, attrs, attrsRaw, "", "cumulative", false)
			point := appendDistributionPoint(batch, seriesKey, dp.Timestamp().AsTime(), optionalTimestamp(dp.StartTimestamp()), uint32(dp.Flags()),
				dp.Count(), floatPtr(dp.Sum()), nil, nil)
			quantiles := dp.QuantileValues()
			point.SummaryQuantiles = make([]float64, quantiles.Len())
			point.SummaryQuantileValues = make([]float64, quantiles.Len())
			for j := 0; j < quantiles.Len(); j++ {
				point.SummaryQuantiles[j] = quantiles.At(j).Quantile()
				point.SummaryQuantileValues[j] = quantiles.At(j).Value()
			}
		}
	}
}

func appendHistogramLayout(batch *MetricBatch, layout HistogramLayoutRow, seen map[uint64]struct{}) {
	if _, ok := seen[layout.LayoutHash]; ok {
		return
	}
	seen[layout.LayoutHash] = struct{}{}
	batch.HistogramLayouts = append(batch.HistogramLayouts, layout)
}

func hashHistogramLayout(layout HistogramLayoutRow) uint64 {
	return histogramLayoutHash(layout.Kind, layout.ExplicitBounds, layout.Scale, layout.ZeroThreshold)
}

// appendScalarPoint appends one Gauge/Sum observation (a plain Value, no
// Count/Sum/Min/Max) to batch.Points — shared by convertMetric's Gauge and
// Sum arms, which differ only in the series metadata (temporality/
// isMonotonic) passed to addSeries beforehand.
func appendScalarPoint(batch *MetricBatch, seriesKey uint64, ts time.Time, startTS *time.Time, flags uint32, valueInt *int64, valueDouble *float64) *MetricPointRow {
	batch.Points = append(batch.Points, MetricPointRow{
		ID:          newRowID(),
		SeriesKey:   seriesKey,
		TS:          ts,
		StartTS:     startTS,
		Flags:       flags,
		ValueInt:    valueInt,
		ValueDouble: valueDouble,
	})
	return &batch.Points[len(batch.Points)-1]
}

// appendDistributionPoint appends one Histogram/ExponentialHistogram/Summary
// observation (Count/Sum/Min/Max, no Value) to batch.Points — shared by
// convertMetric's three distribution-shaped arms, which differ only in how
// they populate sum/min/max (Summary has no HasSum/HasMin/HasMax concept and
// always reports Sum, never Min/Max).
func appendDistributionPoint(batch *MetricBatch, seriesKey uint64, ts time.Time, startTS *time.Time, flags uint32, count uint64, sum, min, max *float64) *MetricPointRow {
	batch.Points = append(batch.Points, MetricPointRow{
		ID:        newRowID(),
		SeriesKey: seriesKey,
		TS:        ts,
		StartTS:   startTS,
		Flags:     flags,
		Count:     uint64Ptr(count),
		Sum:       sum,
		Min:       min,
		Max:       max,
	})
	return &batch.Points[len(batch.Points)-1]
}

func appendExemplars(batch *MetricBatch, pointID uuid.UUID, exemplars pmetric.ExemplarSlice) {
	for i := 0; i < exemplars.Len(); i++ {
		exemplar := exemplars.At(i)
		valueInt, valueDouble := exemplarValue(exemplar)
		batch.Exemplars = append(batch.Exemplars, MetricExemplarRow{
			ID:                    newRowID(),
			PointID:               pointID,
			TS:                    exemplar.Timestamp().AsTime(),
			TraceID:               exemplar.TraceID().String(),
			SpanID:                exemplar.SpanID().String(),
			FilteredAttributes:    attributesToMap(exemplar.FilteredAttributes()),
			FilteredAttributesRaw: encodeOTLPAttributes(exemplar.FilteredAttributes()),
			ValueInt:              valueInt,
			ValueDouble:           valueDouble,
		})
	}
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

func numberValue(dp pmetric.NumberDataPoint) (*int64, *float64, string) {
	switch dp.ValueType() {
	case pmetric.NumberDataPointValueTypeInt:
		value := dp.IntValue()
		return &value, nil, "int"
	case pmetric.NumberDataPointValueTypeDouble:
		value := dp.DoubleValue()
		return nil, &value, "double"
	default:
		return nil, nil, ""
	}
}

func exemplarValue(exemplar pmetric.Exemplar) (*int64, *float64) {
	switch exemplar.ValueType() {
	case pmetric.ExemplarValueTypeInt:
		value := exemplar.IntValue()
		return &value, nil
	case pmetric.ExemplarValueTypeDouble:
		value := exemplar.DoubleValue()
		return nil, &value
	default:
		return nil, nil
	}
}

func floatPtr(v float64) *float64 { return &v }
func uint64Ptr(v uint64) *uint64  { return &v }

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
