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
	ids := distinctTraceIDs(batch.Spans)
	searchValues := traceSearchValues(batch)
	summaries, err := s.TraceSummariesByIDs(ctx, ids)
	if err != nil {
		slog.Error("broadcast: trace summaries lookup failed", "trace_count", len(ids), "error", err)
		return
	}
	for i := range summaries {
		onAdd(ctx, SignalTraces, traceSummaryToTraceData(&summaries[i], searchValues[summaries[i].TraceID]))
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
	windows := make([]storage.MetricPointWindow, len(order))
	for i, k := range order {
		windows[i] = storage.MetricPointWindow{
			ServiceName: k.service,
			MetricName:  k.name,
			From:        minTS[k],
			To:          maxTS[k].Add(metricLeadMargin),
		}
	}
	pointsByMetric, err := s.MetricPointsWithPredecessorsBatch(ctx, windows)
	if err != nil {
		slog.Error("broadcast: metric points batch lookup failed", "metric_count", len(order), "error", err)
		return
	}

	for i, k := range order {
		sr := seriesRowFor(seriesInfo, k)

		// storage.FilterDerivedPoints drops baseline observations (the first
		// point of a cumulative series, with no predecessor for lag() to
		// derive a delta from) — the old store package's seriesStore never
		// broadcast these either; the newIDs membership check below then
		// narrows that down to just this batch's newly-appended points.
		dataPoints := make([]DataPoint, 0, len(newIDs[k]))
		for _, p := range storage.FilterDerivedPoints(pointsByMetric[i]) {
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
