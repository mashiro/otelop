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

	"github.com/mashiro/otelop/internal/storage"
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
			broadcastTraces(ctx, s, ev.Traces, onAdd)
		case storage.KindMetrics:
			broadcastMetrics(ctx, s, ev.Metrics, onAdd)
		case storage.KindLogs:
			broadcastLogs(ctx, ev.Logs, onAdd)
		}
	}
}

func broadcastTraces(ctx context.Context, s *storage.Storage, batch storage.TraceBatch, onAdd OnAddFunc) {
	for _, id := range distinctTraceIDs(batch.Spans) {
		detail, ok, err := s.TraceByID(ctx, id)
		if err != nil {
			slog.Error("broadcast: trace lookup failed", "trace_id", id, "error", err)
			continue
		}
		if !ok {
			// Should not happen — the span was just appended — but a
			// concurrent Clear/Sweep is a real (if rare) race.
			continue
		}
		onAdd(ctx, SignalTraces, traceDetailToTraceData(detail))
	}
}

func distinctTraceIDs(spans []storage.SpanRow) []string {
	seen := make(map[string]struct{}, len(spans))
	ids := make([]string, 0, len(spans))
	for _, sp := range spans {
		if _, ok := seen[sp.TraceID]; ok {
			continue
		}
		seen[sp.TraceID] = struct{}{}
		ids = append(ids, sp.TraceID)
	}
	return ids
}

func traceDetailToTraceData(d *storage.TraceDetail) *TraceData {
	spans := make([]*SpanData, len(d.Spans))
	for i := range d.Spans {
		spans[i] = spanDetailToSpanData(&d.Spans[i])
	}
	var rootSpan *SpanData
	if root := storage.PickRootSpan(d.Spans); root != nil {
		rootSpan = spanDetailToSpanData(root)
	}
	return &TraceData{
		TraceID:     d.TraceID,
		RootSpan:    rootSpan,
		Spans:       spans,
		ServiceName: d.ServiceName,
		SpanCount:   d.SpanCount,
		StartTime:   d.StartTime,
		Duration:    d.Duration,
		HasError:    d.HasError,
	}
}

func spanDetailToSpanData(sp *storage.SpanDetail) *SpanData {
	return &SpanData{
		TraceID:      sp.TraceID,
		SpanID:       sp.SpanID,
		ParentSpanID: sp.ParentSpanID,
		Name:         sp.Name,
		Kind:         sp.Kind,
		ServiceName:  sp.ServiceName,
		StartTime:    sp.StartTS,
		EndTime:      sp.EndTS,
		Duration:     sp.Duration,
		StatusCode:   sp.StatusCode,
		StatusMsg:    sp.StatusMessage,
		Attributes:   sp.Attributes,
		Events:       convertEvents(sp.Events),
		Resource:     sp.Resource,
	}
}

func convertEvents(events []storage.SpanEventRow) []SpanEvent {
	if len(events) == 0 {
		// The WebSocket contract matches GraphQL's non-null [SpanEvent!]!:
		// encode an empty list as [] rather than nil as JSON null.
		return []SpanEvent{}
	}
	out := make([]SpanEvent, len(events))
	for i, e := range events {
		out[i] = SpanEvent{
			Name:       e.Name,
			Timestamp:  e.Timestamp,
			Attributes: e.Attributes,
		}
	}
	return out
}

// metricKey identifies one (service, metric name) group — the granularity
// the old store package's MetricData broadcast at.
type metricKey struct {
	service, name string
}

func broadcastMetrics(ctx context.Context, s *storage.Storage, batch storage.MetricBatch, onAdd OnAddFunc) {
	if len(batch.Points) == 0 {
		return
	}

	// ConvertMetrics (internal/storage/convert.go) always includes a
	// MetricSeriesRow for every series referenced by Points in this same
	// batch — and a ResourceRow for every resource referenced by Series —
	// whether or not they already existed in the DB, so neither map needs a
	// DB round trip.
	seriesInfo := make(map[uint64]storage.MetricSeriesRow, len(batch.Series))
	for _, sr := range batch.Series {
		seriesInfo[sr.SeriesKey] = sr
	}
	resourceByHash := make(map[uint64]storage.ResourceRow, len(batch.Resources))
	for _, r := range batch.Resources {
		resourceByHash[r.ResourceHash] = r
	}

	newIDs := make(map[metricKey]map[uuidKey]struct{})
	minTS := make(map[metricKey]time.Time)
	maxTS := make(map[metricKey]time.Time)
	var order []metricKey
	for _, p := range batch.Points {
		sr, ok := seriesInfo[p.SeriesKey]
		if !ok {
			slog.Warn("broadcast: metric point references unknown series", "series_key", p.SeriesKey)
			continue
		}
		k := metricKey{service: sr.ServiceName, name: sr.MetricName}
		if _, seen := newIDs[k]; !seen {
			newIDs[k] = make(map[uuidKey]struct{})
			minTS[k] = p.TS
			maxTS[k] = p.TS
			order = append(order, k)
		}
		newIDs[k][uuidKey(p.ID)] = struct{}{}
		if p.TS.Before(minTS[k]) {
			minTS[k] = p.TS
		}
		if p.TS.After(maxTS[k]) {
			maxTS[k] = p.TS
		}
	}

	now := time.Now()
	for _, k := range order {
		sr := seriesRowFor(seriesInfo, k)
		from := minTS[k]
		to := maxTS[k].Add(metricLeadMargin)
		points, err := s.MetricPointsWithPredecessors(ctx, k.service, k.name, from, to)
		if err != nil {
			slog.Error("broadcast: metric points lookup failed", "service", k.service, "metric", k.name, "error", err)
			continue
		}

		// storage.FilterDerivedPoints drops baseline observations (the first
		// point of a cumulative series, with no predecessor for lag() to
		// derive a delta from) — the old store package's seriesStore never
		// broadcast these either; the newIDs membership check below then
		// narrows that down to just this batch's newly-appended points.
		dataPoints := make([]DataPoint, 0, len(newIDs[k]))
		for _, p := range storage.FilterDerivedPoints(points) {
			if _, isNew := newIDs[k][uuidKey(p.ID)]; !isNew {
				continue
			}
			dataPoints = append(dataPoints, DataPoint{
				ID:              p.ID.String(),
				Timestamp:       p.TS,
				Value:           *p.Value,
				Cumulative:      p.Cumulative,
				Count:           p.Count,
				CountCumulative: p.CountCumulative,
				Sum:             p.Sum,
				SumCumulative:   p.SumCumulative,
				Min:             p.Min,
				Max:             p.Max,
				Attributes:      p.Attributes,
			})
		}
		if len(dataPoints) == 0 {
			continue
		}

		onAdd(ctx, SignalMetrics, &MetricData{
			Name:        sr.MetricName,
			Description: sr.Description,
			Unit:        sr.Unit,
			Type:        sr.MetricType,
			ServiceName: sr.ServiceName,
			Resource:    resourceByHash[sr.ResourceHash].Attributes,
			DataPoints:  dataPoints,
			ReceivedAt:  now,
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
