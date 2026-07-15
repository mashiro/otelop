package graphql

import (
	gql "github.com/graph-gophers/graphql-go"

	"context"
	"sync"

	"github.com/mashiro/otelop/internal/storage"
)

// LogResolver carries a storage handle so Trace/Span can look up the
// correlated trace. Both fields fetch the same TraceByID, so the fetch is
// memoized (the same sync.Once pattern TraceResolver.loadDetail uses)
// rather than each resolving independently — a query selecting both
// Log.trace and Log.span on the same row must only issue one TraceByID
// call, not two.
type LogResolver struct {
	storage *storage.Storage
	l       storage.LogDetail

	once     sync.Once
	trace    *storage.TraceDetail
	traceErr error
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

// loadTrace fetches and memoizes r.l.TraceID's TraceDetail exactly once, so
// a query selecting both Trace and Span on the same LogResolver issues one
// TraceByID call instead of two. ok is false when the log has no trace_id or
// the trace no longer exists.
func (r *LogResolver) loadTrace(ctx context.Context) (*storage.TraceDetail, bool, error) {
	if r.l.TraceID == "" {
		return nil, false, nil
	}
	r.once.Do(func() {
		d, ok, err := r.storage.TraceByID(ctx, r.l.TraceID)
		if err != nil {
			r.traceErr = err
			return
		}
		if ok {
			r.trace = d
		}
	})
	return r.trace, r.trace != nil, r.traceErr
}

func (r *LogResolver) Trace(ctx context.Context) (*TraceResolver, error) {
	d, ok, err := r.loadTrace(ctx)
	if err != nil || !ok {
		return nil, err
	}
	return newTraceResolverFromDetail(r.storage, d), nil
}

func (r *LogResolver) Span(ctx context.Context) (*SpanResolver, error) {
	if r.l.SpanID == "" {
		return nil, nil
	}
	d, ok, err := r.loadTrace(ctx)
	if err != nil || !ok {
		return nil, err
	}
	for i := range d.Spans {
		if d.Spans[i].SpanID == r.l.SpanID {
			return &SpanResolver{storage: r.storage, trace: d, s: &d.Spans[i]}, nil
		}
	}
	return nil, nil
}
