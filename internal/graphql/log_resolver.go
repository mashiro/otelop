package graphql

import (
	gql "github.com/graph-gophers/graphql-go"

	"context"

	"github.com/mashiro/otelop/internal/storage"
)

type LogResolver struct {
	storage *storage.Storage
	l       storage.LogDetail
}

func (r *LogResolver) ID() gql.ID                  { return gql.ID(r.l.ID.String()) }
func (r *LogResolver) Timestamp() gql.Time         { return gql.Time{Time: r.l.TS} }
func (r *LogResolver) ObservedTimestamp() gql.Time { return gql.Time{Time: r.l.ObservedTS} }
func (r *LogResolver) TraceID() string             { return r.l.TraceID }
func (r *LogResolver) SpanID() string              { return r.l.SpanID }
func (r *LogResolver) SeverityNumber() int32       { return r.l.SeverityNumber }
func (r *LogResolver) SeverityText() string        { return r.l.SeverityText }
func (r *LogResolver) Body() string                { return r.l.Body }
func (r *LogResolver) ServiceName() string         { return r.l.ServiceName }
func (r *LogResolver) Attributes() JSONMap         { return attrsToJSON(r.l.Attributes) }
func (r *LogResolver) Resource() JSONMap           { return attrsToJSON(r.l.Resource) }

func (r *LogResolver) Trace(ctx context.Context) (*TraceResolver, error) {
	if r.l.TraceID == "" {
		return nil, nil
	}
	d, ok, err := r.storage.TraceByID(ctx, r.l.TraceID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}
	return newTraceResolverFromDetail(r.storage, d), nil
}

func (r *LogResolver) Span(ctx context.Context) (*SpanResolver, error) {
	if r.l.TraceID == "" || r.l.SpanID == "" {
		return nil, nil
	}
	d, ok, err := r.storage.TraceByID(ctx, r.l.TraceID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}
	for i := range d.Spans {
		if d.Spans[i].SpanID == r.l.SpanID {
			return &SpanResolver{storage: r.storage, trace: d, s: &d.Spans[i]}, nil
		}
	}
	return nil, nil
}
