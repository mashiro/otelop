package graphql

import (
	"time"

	gql "github.com/graph-gophers/graphql-go"

	"github.com/mashiro/otelop/internal/store"
)

// TraceResolver carries a store handle so Trace.logs can issue the
// correlation query without plumbing extra state through.
type TraceResolver struct {
	store *store.Store
	t     *store.TraceData
}

func (r *TraceResolver) TraceID() gql.ID     { return gql.ID(r.t.TraceID) }
func (r *TraceResolver) ServiceName() string { return r.t.ServiceName }
func (r *TraceResolver) SpanCount() int32    { return int32(r.t.SpanCount) }
func (r *TraceResolver) StartTime() gql.Time { return gql.Time{Time: r.t.StartTime} }
func (r *TraceResolver) DurationMs() float64 { return durationMs(r.t.Duration) }
func (r *TraceResolver) HasError() bool      { return r.t.HasError }

func (r *TraceResolver) RootSpan() *SpanResolver {
	if r.t.RootSpan == nil {
		return nil
	}
	return &SpanResolver{store: r.store, trace: r.t, s: r.t.RootSpan}
}

func (r *TraceResolver) Spans() []*SpanResolver {
	out := make([]*SpanResolver, len(r.t.Spans))
	for i, s := range r.t.Spans {
		out[i] = &SpanResolver{store: r.store, trace: r.t, s: s}
	}
	return out
}

func (r *TraceResolver) Logs() []*LogResolver {
	items, _ := r.store.GetLogsPageByTraceID(r.t.TraceID, 0, 0)
	out := make([]*LogResolver, len(items))
	for i, l := range items {
		out[i] = &LogResolver{store: r.store, l: l}
	}
	return out
}

// SpanResolver carries a back-pointer to the owning TraceData so span.trace
// and span.parent resolve without re-querying the store.
type SpanResolver struct {
	store *store.Store
	trace *store.TraceData
	s     *store.SpanData
}

func (r *SpanResolver) TraceID() gql.ID       { return gql.ID(r.s.TraceID) }
func (r *SpanResolver) SpanID() gql.ID        { return gql.ID(r.s.SpanID) }
func (r *SpanResolver) ParentSpanID() string  { return r.s.ParentSpanID }
func (r *SpanResolver) Name() string          { return r.s.Name }
func (r *SpanResolver) Kind() string          { return r.s.Kind }
func (r *SpanResolver) ServiceName() string   { return r.s.ServiceName }
func (r *SpanResolver) StartTime() gql.Time   { return gql.Time{Time: r.s.StartTime} }
func (r *SpanResolver) EndTime() gql.Time     { return gql.Time{Time: r.s.EndTime} }
func (r *SpanResolver) DurationMs() float64   { return durationMs(r.s.Duration) }
func (r *SpanResolver) StatusCode() string    { return r.s.StatusCode }
func (r *SpanResolver) StatusMessage() string { return r.s.StatusMsg }
func (r *SpanResolver) Attributes() JSONMap   { return attrsToJSON(r.s.Attributes) }
func (r *SpanResolver) Resource() JSONMap     { return attrsToJSON(r.s.Resource) }

func (r *SpanResolver) Events() []*SpanEventResolver {
	out := make([]*SpanEventResolver, len(r.s.Events))
	for i := range r.s.Events {
		out[i] = &SpanEventResolver{ev: &r.s.Events[i]}
	}
	return out
}

// Trace is the edge back to the owning trace — always present because spans
// are only ever returned via a Trace in the schema.
func (r *SpanResolver) Trace() *TraceResolver {
	return &TraceResolver{store: r.store, t: r.trace}
}

// Parent is the edge to the parent span within the same trace. Returns nil
// for root spans (ParentSpanID empty) or when the parent has not been
// buffered under the same trace.
func (r *SpanResolver) Parent() *SpanResolver {
	parent := r.trace.SpanByID(r.s.ParentSpanID)
	if parent == nil {
		return nil
	}
	return &SpanResolver{store: r.store, trace: r.trace, s: parent}
}

type SpanEventResolver struct {
	ev *store.SpanEvent
}

func (r *SpanEventResolver) Name() string        { return r.ev.Name }
func (r *SpanEventResolver) Timestamp() gql.Time { return gql.Time{Time: r.ev.Timestamp} }
func (r *SpanEventResolver) Attributes() JSONMap { return attrsToJSON(r.ev.Attributes) }

func durationMs(d time.Duration) float64 {
	return float64(d) / float64(time.Millisecond)
}

func attrsToJSON(m map[string]any) JSONMap {
	if m == nil {
		return JSONMap{}
	}
	return JSONMap(m)
}
