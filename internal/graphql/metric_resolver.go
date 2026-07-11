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
// baseline observations (storage.FilterDerivedPoints — the same rule
// internal/broadcast's WebSocket path applies) so the GraphQL surface
// matches what the WebSocket path ever broadcasts and what the old store
// package used to return.
func (r *MetricResolver) filteredPoints(ctx context.Context) ([]storage.DerivedPoint, error) {
	r.once.Do(func() {
		points, err := r.storage.MetricPoints(ctx, r.m.ServiceName, r.m.MetricName, r.from, r.to)
		if err != nil {
			r.err = err
			return
		}
		r.points = storage.FilterDerivedPoints(points)
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

func (r *DataPointResolver) ID() gql.ID                { return gql.ID(r.dp.ID.String()) }
func (r *DataPointResolver) Timestamp() gql.Time       { return gql.Time{Time: r.dp.TS} }
func (r *DataPointResolver) Value() float64            { return floatOrZero(r.dp.Value) }
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
func (r *AggregatePointResolver) Value() float64      { return floatOrZero(r.p.Value) }
func (r *AggregatePointResolver) Count() *float64     { return r.p.Count }
func (r *AggregatePointResolver) Sum() *float64       { return r.p.Sum }
func (r *AggregatePointResolver) Min() *float64       { return r.p.Min }
func (r *AggregatePointResolver) Max() *float64       { return r.p.Max }

// floatOrZero unwraps an optional derived value to 0 when nil (a baseline
// observation with nothing to derive yet) — the GraphQL schema's Value
// field is non-nullable, unlike the storage layer's pointer representation.
func floatOrZero(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}
