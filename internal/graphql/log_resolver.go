package graphql

import (
	gql "github.com/graph-gophers/graphql-go"

	"github.com/mashiro/otelop/internal/store"
)

type LogResolver struct {
	store *store.Store
	l     *store.LogData
}

func (r *LogResolver) Timestamp() gql.Time         { return gql.Time{Time: r.l.Timestamp} }
func (r *LogResolver) ObservedTimestamp() gql.Time { return gql.Time{Time: r.l.ObservedTimestamp} }
func (r *LogResolver) TraceID() string             { return r.l.TraceID }
func (r *LogResolver) SpanID() string              { return r.l.SpanID }
func (r *LogResolver) SeverityNumber() int32       { return r.l.SeverityNumber }
func (r *LogResolver) SeverityText() string        { return r.l.SeverityText }
func (r *LogResolver) Body() string                { return r.l.Body }
func (r *LogResolver) ServiceName() string         { return r.l.ServiceName }
func (r *LogResolver) Attributes() JSONMap         { return attrsToJSON(r.l.Attributes) }
func (r *LogResolver) Resource() JSONMap           { return attrsToJSON(r.l.Resource) }

func (r *LogResolver) Trace() *TraceResolver {
	if r.l.TraceID == "" {
		return nil
	}
	t, ok := r.store.GetTraceByID(r.l.TraceID)
	if !ok {
		return nil
	}
	return &TraceResolver{store: r.store, t: t}
}

func (r *LogResolver) Span() *SpanResolver {
	if r.l.TraceID == "" || r.l.SpanID == "" {
		return nil
	}
	t, ok := r.store.GetTraceByID(r.l.TraceID)
	if !ok {
		return nil
	}
	for _, s := range t.Spans {
		if s.SpanID == r.l.SpanID {
			return &SpanResolver{store: r.store, trace: t, s: s}
		}
	}
	return nil
}
