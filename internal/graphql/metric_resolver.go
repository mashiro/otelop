package graphql

import (
	"context"
	"sync"
	"time"

	gql "github.com/graph-gophers/graphql-go"

	"github.com/mashiro/otelop/internal/storage"
)

// MetricResolver represents one (service, metric name) group. DataPoints are
// fetched lazily (a metric list page never needs them unless the query
// selects dataPoints/pointCount) and memoized so requesting both in the same
// query issues one storage.MetricPoints call.
type MetricResolver struct {
	storage  *storage.Storage
	m        storage.MetricSummary
	from, to time.Time

	once   sync.Once
	points []storage.DerivedPoint
	err    error
}

func (r *MetricResolver) Name() string         { return r.m.MetricName }
func (r *MetricResolver) Description() string  { return r.m.Description }
func (r *MetricResolver) Unit() string         { return r.m.Unit }
func (r *MetricResolver) Type() string         { return r.m.Type }
func (r *MetricResolver) ServiceName() string  { return r.m.ServiceName }
func (r *MetricResolver) ReceivedAt() gql.Time { return gql.Time{Time: r.m.LastSeen} }

func (r *MetricResolver) Resource() JSONMap { return attrsToJSON(r.m.Resource) }

// filteredPoints fetches every derived point in [from, to) and drops
// baseline observations (see internal/broadcast's identical rule) so the
// GraphQL surface matches what the WebSocket path ever broadcasts and what
// the old store package used to return.
func (r *MetricResolver) filteredPoints(ctx context.Context) ([]storage.DerivedPoint, error) {
	r.once.Do(func() {
		points, err := r.storage.MetricPoints(ctx, r.m.ServiceName, r.m.MetricName, r.from, r.to)
		if err != nil {
			r.err = err
			return
		}
		r.points = filterDerivedPoints(points)
	})
	return r.points, r.err
}

// LatestValue is a cheap, non-memoized alternative to DataPoints/PointCount:
// it never fetches the group's full point history, so a caller wanting only
// this field never pays filteredPoints' storage.MetricPoints cost (see issue
// #162's list-render motivation).
func (r *MetricResolver) LatestValue(ctx context.Context) (*float64, error) {
	return r.storage.LatestValue(ctx, r.m.ServiceName, r.m.MetricName)
}

// isDistributionType reports whether metricType names one of the
// distribution shapes (Histogram/ExponentialHistogram/Summary), which carry
// Count/Sum instead of a plain Value — see DataPoint's schema doc comment.
func isDistributionType(metricType string) bool {
	return metricType == "Histogram" || metricType == "ExponentialHistogram" || metricType == "Summary"
}

// filterDerivedPoints drops baseline observations — a point with nothing to
// derive a delta against yet, invisible to any caller (internal/broadcast's
// WebSocket path has the identical rule) — using each row's own Type rather
// than a separately-fetched MetricSummary, so both MetricResolver.DataPoints
// (which already has one) and the top-level metricPoints query (which
// doesn't) apply the exact same rule through one implementation.
func filterDerivedPoints(points []storage.DerivedPoint) []storage.DerivedPoint {
	filtered := make([]storage.DerivedPoint, 0, len(points))
	for _, p := range points {
		if p.Value == nil {
			continue
		}
		if isDistributionType(p.Type) && p.Count == nil {
			continue
		}
		filtered = append(filtered, p)
	}
	return filtered
}

func (r *MetricResolver) DataPoints(ctx context.Context) ([]*DataPointResolver, error) {
	points, err := r.filteredPoints(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]*DataPointResolver, len(points))
	for i := range points {
		out[i] = &DataPointResolver{dp: points[i]}
	}
	return out, nil
}

func (r *MetricResolver) PointCount(ctx context.Context) (int32, error) {
	points, err := r.filteredPoints(ctx)
	if err != nil {
		return 0, err
	}
	return int32(len(points)), nil
}

type DataPointResolver struct {
	dp storage.DerivedPoint
}

func (r *DataPointResolver) ID() gql.ID          { return gql.ID(r.dp.ID.String()) }
func (r *DataPointResolver) Timestamp() gql.Time { return gql.Time{Time: r.dp.TS} }
func (r *DataPointResolver) Value() float64 {
	if r.dp.Value == nil {
		return 0
	}
	return *r.dp.Value
}
func (r *DataPointResolver) Cumulative() *float64      { return r.dp.Cumulative }
func (r *DataPointResolver) Count() *float64           { return r.dp.Count }
func (r *DataPointResolver) CountCumulative() *float64 { return r.dp.CountCumulative }
func (r *DataPointResolver) Sum() *float64             { return r.dp.Sum }
func (r *DataPointResolver) SumCumulative() *float64   { return r.dp.SumCumulative }
func (r *DataPointResolver) Min() *float64             { return r.dp.Min }
func (r *DataPointResolver) Max() *float64             { return r.dp.Max }
func (r *DataPointResolver) Attributes() JSONMap       { return attrsToJSON(r.dp.Attributes) }

// AggregateSeriesResolver wraps one storage.AggregateSeries — one line on
// the chart's facet view (see schema.graphql's metricAggregate doc comment).
type AggregateSeriesResolver struct {
	series storage.AggregateSeries
}

func (r *AggregateSeriesResolver) GroupValues() []string { return r.series.GroupValues }

func (r *AggregateSeriesResolver) Points() []*AggregatePointResolver {
	out := make([]*AggregatePointResolver, len(r.series.Points))
	for i := range r.series.Points {
		out[i] = &AggregatePointResolver{p: r.series.Points[i]}
	}
	return out
}

type AggregatePointResolver struct {
	p storage.AggregatePoint
}

func (r *AggregatePointResolver) Timestamp() gql.Time { return gql.Time{Time: r.p.TS} }
func (r *AggregatePointResolver) Value() float64 {
	if r.p.Value == nil {
		return 0
	}
	return *r.p.Value
}
func (r *AggregatePointResolver) Count() *float64 { return r.p.Count }
func (r *AggregatePointResolver) Sum() *float64   { return r.p.Sum }
func (r *AggregatePointResolver) Min() *float64   { return r.p.Min }
func (r *AggregatePointResolver) Max() *float64   { return r.p.Max }
