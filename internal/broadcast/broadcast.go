// Package broadcast bridges internal/storage's OnCommit hook to the legacy
// WebSocket wire shapes frontend/src/types/telemetry.ts expects
// (docs/design/duckdb-storage.md Phase 3). The wire DTOs (TraceData,
// SpanData, MetricData, DataPoint, LogData, ...) used to live in
// the old store package; they now live in this package's wire.go (Phase 5 deleted
// the old store package entirely), stripped of the store-internal machinery
// (Merge, ring-buffer indices) that never marshaled.
package broadcast

import (
	"context"
	"log/slog"
	"time"

	"github.com/mashiro/otelop/internal/selftelemetry"
	"github.com/mashiro/otelop/internal/storage"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// metricLeadMargin nudges the query's exclusive upper bound past the
// batch's latest point timestamp so that exact-timestamp point is included.
const metricLeadMargin = 1 * time.Second

// New returns a storage.OnCommitFunc that translates each CommitEvent into
// the legacy wire-shaped payloads and invokes onAdd once per logical item —
// one call per distinct trace, one per distinct (service, metric) pair, and
// one per log row — matching the old store package's per-record broadcast
// granularity.
func New(s *storage.Storage, onAdd OnAddFunc) storage.OnCommitFunc {
	return func(ctx context.Context, ev storage.CommitEvent) {
		switch ev.Kind {
		case storage.KindTraces:
			broadcastTraces(ctx, ev.Traces, onAdd)
		case storage.KindMetrics:
			broadcastMetrics(ctx, s, ev.Metrics, onAdd)
		case storage.KindLogs:
			broadcastLogs(ctx, ev.Logs, onAdd)
		}
	}
}

// NewBatch returns the batch-aware broadcaster used by the server. Adjacent
// metric commits share one predecessor query, while their WebSocket messages
// are still emitted in the original commit order and granularity. When
// shouldBroadcast reports no connected clients, all read-back work is
// skipped; a later client gets the committed rows through its initial
// GraphQL load.
func NewBatch(s *storage.Storage, onAdd OnAddFunc, shouldBroadcast func() bool) storage.OnCommitBatchFunc {
	return func(deliveries []storage.CommitDelivery) {
		if len(deliveries) == 0 || !shouldBroadcast() {
			return
		}
		if deliveries[0].Event.Kind == storage.KindMetrics {
			broadcastMetricDeliveries(s, deliveries, onAdd)
			return
		}
		for _, delivery := range deliveries {
			New(s, onAdd)(delivery.Ctx, delivery.Event)
		}
	}
}

func broadcastTraces(ctx context.Context, batch storage.TraceBatch, onAdd OnAddFunc) {
	for _, traceID := range batch.DroppedTraceIDs {
		onAdd(ctx, SignalTraceDeletes, &TraceDeleteData{TraceID: traceID})
	}
	ctx, span := startBroadcastSpan(ctx, "broadcast.broadcastTraces")
	span.SetAttributes(attribute.Int("storage.batch.rows", len(batch.Spans)), attribute.Int("storage.batch.trace_count", len(batch.Summaries)))
	defer span.End()
	searchValues := traceSearchValues(batch)
	for i := range batch.Summaries {
		onAdd(ctx, SignalTraces, traceSummaryToTraceData(&batch.Summaries[i], searchValues[batch.Summaries[i].TraceID]))
	}
}

func traceSearchValues(batch storage.TraceBatch) map[string][]string {
	serviceByHash := make(map[uint64]string, len(batch.Resources))
	for _, resource := range batch.Resources {
		serviceByHash[resource.ResourceHash] = resource.ServiceName
	}
	values := make(map[string][]string)
	for _, span := range batch.Spans {
		values[span.TraceID] = append(values[span.TraceID], span.Name, span.StatusCode, serviceByHash[span.ResourceHash])
	}
	return values
}

func traceSummaryToTraceData(s *storage.TraceSummary, searchValues []string) *TraceData {
	var rootSpan *TraceRootSpanData
	if s.HasRoot {
		rootSpan = &TraceRootSpanData{
			Name:       s.RootName,
			Kind:       s.RootKind,
			Duration:   s.RootDuration,
			StatusCode: s.RootStatusCode,
		}
	}
	return &TraceData{
		TraceID:      s.TraceID,
		RootSpan:     rootSpan,
		Spans:        []*SpanData{},
		ServiceName:  s.ServiceName,
		SearchValues: searchValues,
		SpanCount:    s.SpanCount,
		StartTime:    s.StartTime,
		Duration:     s.Duration,
		HasError:     s.HasError,
	}
}

// metricKey identifies one (service, metric name) group — the granularity
// the old store package's MetricData broadcast at.
type metricKey struct {
	service, name string
}

func broadcastMetrics(ctx context.Context, s *storage.Storage, batch storage.MetricBatch, onAdd OnAddFunc) {
	broadcastMetricDeliveries(s, []storage.CommitDelivery{{Ctx: ctx, Event: storage.CommitEvent{Kind: storage.KindMetrics, Metrics: batch}}}, onAdd)
}

type metricBroadcastPlan struct {
	ctx            context.Context
	batch          storage.MetricBatch
	seriesInfo     map[uint64]storage.MetricSeriesRow
	resourceByHash map[uint64]storage.ResourceRow
	pointIDs       map[metricKey][]uuidKey
	order          []metricKey
}

func broadcastMetricDeliveries(s *storage.Storage, deliveries []storage.CommitDelivery, onAdd OnAddFunc) {
	plans := make([]metricBroadcastPlan, 0, len(deliveries))
	minTS := make(map[metricKey]time.Time)
	maxTS := make(map[metricKey]time.Time)
	var metricOrder []metricKey
	for _, delivery := range deliveries {
		batch := delivery.Event.Metrics
		if len(batch.Points) == 0 {
			continue
		}
		plan := prepareMetricBroadcast(delivery.Ctx, batch)
		for _, key := range plan.order {
			for _, point := range batch.Points {
				series, ok := plan.seriesInfo[point.SeriesKey]
				if !ok || series.ServiceName != key.service || series.MetricName != key.name {
					continue
				}
				if _, seen := minTS[key]; !seen {
					minTS[key], maxTS[key] = point.TS, point.TS
					metricOrder = append(metricOrder, key)
				}
				if point.TS.Before(minTS[key]) {
					minTS[key] = point.TS
				}
				if point.TS.After(maxTS[key]) {
					maxTS[key] = point.TS
				}
			}
		}
		plans = append(plans, plan)
	}
	if len(plans) == 0 {
		return
	}

	ctx, span := startBroadcastSpan(plans[0].ctx, "broadcast.deriveMetricBatch")
	span.SetAttributes(attribute.Int("storage.batch.commits", len(plans)), attribute.Int("storage.batch.metric_count", len(metricOrder)))
	windows := make([]storage.MetricPointWindow, len(metricOrder))
	for i, key := range metricOrder {
		windows[i] = storage.MetricPointWindow{
			ServiceName: key.service, MetricName: key.name,
			From: minTS[key], To: maxTS[key].Add(metricLeadMargin),
		}
	}
	pointsByMetric, err := s.MetricPointsWithPredecessorsBatch(ctx, windows)
	span.End()
	if err != nil {
		slog.Error("broadcast: metric points batch lookup failed", "metric_count", len(metricOrder), "error", err)
		return
	}
	derivedByMetric := make(map[metricKey][]storage.DerivedPoint, len(metricOrder))
	for i, key := range metricOrder {
		derivedByMetric[key] = storage.FilterDerivedPoints(pointsByMetric[i])
	}
	for _, plan := range plans {
		broadcastMetricPlan(plan, derivedByMetric, onAdd)
	}
}

func prepareMetricBroadcast(ctx context.Context, batch storage.MetricBatch) metricBroadcastPlan {
	plan := metricBroadcastPlan{
		ctx: ctx, batch: batch,
		seriesInfo:     make(map[uint64]storage.MetricSeriesRow, len(batch.Series)),
		resourceByHash: make(map[uint64]storage.ResourceRow, len(batch.Resources)),
		pointIDs:       make(map[metricKey][]uuidKey),
	}
	for _, series := range batch.Series {
		plan.seriesInfo[series.SeriesKey] = series
	}
	for _, resource := range batch.Resources {
		plan.resourceByHash[resource.ResourceHash] = resource
	}
	for _, point := range batch.Points {
		series, ok := plan.seriesInfo[point.SeriesKey]
		if !ok {
			slog.Warn("broadcast: metric point references unknown series", "series_key", point.SeriesKey)
			continue
		}
		key := metricKey{service: series.ServiceName, name: series.MetricName}
		if _, seen := plan.pointIDs[key]; !seen {
			plan.order = append(plan.order, key)
		}
		plan.pointIDs[key] = append(plan.pointIDs[key], uuidKey(point.ID))
	}
	return plan
}

func broadcastMetricPlan(plan metricBroadcastPlan, derivedByMetric map[metricKey][]storage.DerivedPoint, onAdd OnAddFunc) {
	ctx, span := startBroadcastSpan(plan.ctx, "broadcast.broadcastMetrics")
	span.SetAttributes(attribute.Int("storage.batch.rows", len(plan.batch.Points)), attribute.Int("storage.batch.series", len(plan.batch.Series)))
	defer span.End()
	now := time.Now()
	for _, key := range plan.order {
		series := seriesRowFor(plan.seriesInfo, key)
		dataPoints := make([]DataPoint, 0, len(plan.pointIDs[key]))
		ids := make(map[uuidKey]struct{}, len(plan.pointIDs[key]))
		for _, id := range plan.pointIDs[key] {
			ids[id] = struct{}{}
		}
		for _, point := range derivedByMetric[key] {
			if _, ok := ids[uuidKey(point.ID)]; !ok {
				continue
			}
			dataPoints = append(dataPoints, DataPoint{
				ID: point.ID.String(), Timestamp: point.TS, Value: *point.Value,
				Cumulative: point.Cumulative, Count: point.Count, CountCumulative: point.CountCumulative,
				Sum: point.Sum, SumCumulative: point.SumCumulative, Min: point.Min, Max: point.Max,
				Attributes: point.Attributes,
			})
		}
		if len(dataPoints) == 0 {
			continue
		}
		onAdd(ctx, SignalMetrics, &MetricData{
			Name: series.MetricName, Description: series.Description, Unit: series.Unit, Type: series.MetricType,
			ServiceName: series.ServiceName, Resource: plan.resourceByHash[series.ResourceHash].Attributes,
			DataPoints: dataPoints, ReceivedAt: now,
		})
	}
}

// seriesRowFor returns metadata (type/unit/description) for one metric
// group by picking any series row that belongs to it — every attribute
// series of the same (service, name) pair shares this metadata by
// construction (see convert.go's convertMetric).
func seriesRowFor(seriesInfo map[uint64]storage.MetricSeriesRow, k metricKey) storage.MetricSeriesRow {
	for _, sr := range seriesInfo {
		if sr.ServiceName == k.service && sr.MetricName == k.name {
			return sr
		}
	}
	return storage.MetricSeriesRow{ServiceName: k.service, MetricName: k.name}
}

// uuidKey lets uuid.UUID (a [16]byte array) key a map without importing the
// uuid package here just for the type.
type uuidKey [16]byte

func broadcastLogs(ctx context.Context, batch storage.LogBatch, onAdd OnAddFunc) {
	ctx, span := startBroadcastSpan(ctx, "broadcast.broadcastLogs")
	span.SetAttributes(attribute.Int("storage.batch.rows", len(batch.Logs)))
	defer span.End()
	resourceByHash := make(map[uint64]storage.ResourceRow, len(batch.Resources))
	for _, r := range batch.Resources {
		resourceByHash[r.ResourceHash] = r
	}
	for _, l := range batch.Logs {
		res := resourceByHash[l.ResourceHash]
		onAdd(ctx, SignalLogs, &LogData{
			ID:                l.ID.String(),
			Timestamp:         l.TS,
			ObservedTimestamp: l.ObservedTS,
			TraceID:           l.TraceID,
			SpanID:            l.SpanID,
			SeverityNumber:    l.SeverityNumber,
			SeverityText:      l.SeverityText,
			Body:              l.Body,
			ServiceName:       res.ServiceName,
			Attributes:        l.Attributes,
			Resource:          res.Attributes,
		})
	}
}

func startBroadcastSpan(ctx context.Context, name string) (context.Context, trace.Span) {
	if selftelemetry.TracingSuppressed(ctx) {
		return ctx, trace.SpanFromContext(context.Background())
	}
	return otel.Tracer("otelop/broadcast").Start(ctx, name)
}
