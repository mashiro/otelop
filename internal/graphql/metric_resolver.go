package graphql

import (
	gql "github.com/graph-gophers/graphql-go"

	"github.com/mashiro/otelop/internal/store"
)

type MetricResolver struct {
	m *store.MetricData
}

func (r *MetricResolver) Name() string         { return r.m.Name }
func (r *MetricResolver) Description() string  { return r.m.Description }
func (r *MetricResolver) Unit() string         { return r.m.Unit }
func (r *MetricResolver) Type() string         { return r.m.Type }
func (r *MetricResolver) ServiceName() string  { return r.m.ServiceName }
func (r *MetricResolver) Resource() JSONMap    { return attrsToJSON(r.m.Resource) }
func (r *MetricResolver) PointCount() int32    { return int32(len(r.m.DataPoints)) }
func (r *MetricResolver) ReceivedAt() gql.Time { return gql.Time{Time: r.m.ReceivedAt} }

func (r *MetricResolver) DataPoints() []*DataPointResolver {
	out := make([]*DataPointResolver, len(r.m.DataPoints))
	for i := range r.m.DataPoints {
		out[i] = &DataPointResolver{dp: &r.m.DataPoints[i]}
	}
	return out
}

type DataPointResolver struct {
	dp *store.DataPoint
}

func (r *DataPointResolver) Timestamp() gql.Time { return gql.Time{Time: r.dp.Timestamp} }
func (r *DataPointResolver) Value() float64      { return r.dp.Value }
func (r *DataPointResolver) Count() *float64     { return r.dp.Count }
func (r *DataPointResolver) Sum() *float64       { return r.dp.Sum }
func (r *DataPointResolver) Min() *float64       { return r.dp.Min }
func (r *DataPointResolver) Max() *float64       { return r.dp.Max }
func (r *DataPointResolver) Attributes() JSONMap { return attrsToJSON(r.dp.Attributes) }
