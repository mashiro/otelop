package graphql

import (
	"context"
	"sync"
	"time"

	gql "github.com/graph-gophers/graphql-go"

	"github.com/mashiro/otelop/internal/storage"
)

// TraceResolver carries a storage handle so lazily-resolved fields (spans,
// rootSpan, logs) can reach back for correlated data without threading extra
// state through. Constructed either from a list-page TraceSummary (spans not
// yet loaded — TracesPage doesn't fetch them) or from an already-fetched
// TraceDetail (the `trace(traceId)` query, or a SpanResolver's back-edge);
// loadDetail lazily fetches+memoizes the full detail exactly once so that
// requesting both rootSpan and spans on the same trace issues one query, not
// two — Go maps/slice field resolution can run concurrently, so the fetch is
// guarded by sync.Once.
type TraceResolver struct {
	storage *storage.Storage
	id      string
	summary storage.TraceSummary

	once      sync.Once
	detail    *storage.TraceDetail
	detailErr error
}

func newTraceResolver(s *storage.Storage, summary storage.TraceSummary) *TraceResolver {
	return &TraceResolver{storage: s, id: summary.TraceID, summary: summary}
}

func newTraceResolverFromDetail(s *storage.Storage, d *storage.TraceDetail) *TraceResolver {
	return &TraceResolver{storage: s, id: d.TraceID, summary: d.TraceSummary, detail: d}
}

func (r *TraceResolver) loadDetail(ctx context.Context) (*storage.TraceDetail, error) {
	r.once.Do(func() {
		if r.detail != nil {
			return
		}
		d, ok, err := r.storage.TraceByID(ctx, r.id)
		if err != nil {
			r.detailErr = err
			return
		}
		if !ok {
			// The trace existed a moment ago (this resolver came from a
			// TracesPage row) but a concurrent Clear/Sweep raced it away.
			// Fall back to an empty span set rather than erroring the
			// whole query for a benign race.
			r.detail = &storage.TraceDetail{TraceSummary: r.summary}
			return
		}
		r.detail = d
	})
	return r.detail, r.detailErr
}

func (r *TraceResolver) TraceID() gql.ID     { return gql.ID(r.summary.TraceID) }
func (r *TraceResolver) ServiceName() string { return r.summary.ServiceName }
func (r *TraceResolver) SpanCount() int32    { return int32(r.summary.SpanCount) }
func (r *TraceResolver) StartTime() gql.Time { return gql.Time{Time: r.summary.StartTime} }
func (r *TraceResolver) DurationMs() float64 { return durationMs(r.summary.Duration) }
func (r *TraceResolver) HasError() bool      { return r.summary.HasError }

func (r *TraceResolver) RootSpan(ctx context.Context) (*SpanResolver, error) {
	d, err := r.loadDetail(ctx)
	if err != nil {
		return nil, err
	}
	root := pickRootSpan(d.Spans)
	if root == nil {
		return nil, nil
	}
	return &SpanResolver{storage: r.storage, trace: d, s: root}, nil
}

func (r *TraceResolver) Spans(ctx context.Context) ([]*SpanResolver, error) {
	d, err := r.loadDetail(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]*SpanResolver, len(d.Spans))
	for i := range d.Spans {
		out[i] = &SpanResolver{storage: r.storage, trace: d, s: &d.Spans[i]}
	}
	return out, nil
}

func (r *TraceResolver) Logs(ctx context.Context) ([]*LogResolver, error) {
	items, _, err := r.storage.LogsPageByTraceID(ctx, r.id, 0, 0)
	if err != nil {
		return nil, err
	}
	out := make([]*LogResolver, len(items))
	for i := range items {
		out[i] = &LogResolver{storage: r.storage, l: items[i]}
	}
	return out, nil
}

// pickRootSpan reproduces the old store package's isBetterRoot rule: the
// parentless span with the longest duration represents the trace.
func pickRootSpan(spans []storage.SpanDetail) *storage.SpanDetail {
	var root *storage.SpanDetail
	for i := range spans {
		sp := &spans[i]
		if sp.ParentSpanID != "" {
			continue
		}
		if root == nil || sp.Duration > root.Duration {
			root = sp
		}
	}
	return root
}

// SpanResolver carries a back-pointer to the owning TraceDetail so span.trace
// and span.parent resolve without re-querying storage.
type SpanResolver struct {
	storage *storage.Storage
	trace   *storage.TraceDetail
	s       *storage.SpanDetail
}

func (r *SpanResolver) TraceID() gql.ID       { return gql.ID(r.s.TraceID) }
func (r *SpanResolver) SpanID() gql.ID        { return gql.ID(r.s.SpanID) }
func (r *SpanResolver) ParentSpanID() string  { return r.s.ParentSpanID }
func (r *SpanResolver) Name() string          { return r.s.Name }
func (r *SpanResolver) Kind() string          { return r.s.Kind }
func (r *SpanResolver) ServiceName() string   { return r.s.ServiceName }
func (r *SpanResolver) StartTime() gql.Time   { return gql.Time{Time: r.s.StartTS} }
func (r *SpanResolver) EndTime() gql.Time     { return gql.Time{Time: r.s.EndTS} }
func (r *SpanResolver) DurationMs() float64   { return durationMs(r.s.Duration) }
func (r *SpanResolver) StatusCode() string    { return r.s.StatusCode }
func (r *SpanResolver) StatusMessage() string { return r.s.StatusMessage }
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
	return newTraceResolverFromDetail(r.storage, r.trace)
}

// Parent is the edge to the parent span within the same trace. Returns nil
// for root spans (ParentSpanID empty) or when the parent has not been
// buffered under the same trace.
func (r *SpanResolver) Parent() *SpanResolver {
	if r.s.ParentSpanID == "" {
		return nil
	}
	for i := range r.trace.Spans {
		if r.trace.Spans[i].SpanID == r.s.ParentSpanID {
			return &SpanResolver{storage: r.storage, trace: r.trace, s: &r.trace.Spans[i]}
		}
	}
	return nil
}

type SpanEventResolver struct {
	ev *storage.SpanEventRow
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
