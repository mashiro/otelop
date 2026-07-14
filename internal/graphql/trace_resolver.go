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

// RootSpan resolves straight from the TracesPage summary's precomputed
// Root* columns — never loadDetail — so a trace LIST rendering rootSpan for
// every row (the common case: use-initial-load.ts's list query) costs zero
// extra SQL round trips. This was the actual N+1 in the self-telemetry
// trace (815 x Trace.spans/rootSpan → 815 TraceByID calls): the returned
// SpanResolver is "owner-backed" and only pays for loadDetail if a caller
// asks for a field the summary genuinely doesn't carry (see SpanResolver's
// owner-mode fields below).
func (r *TraceResolver) RootSpan() *SpanResolver {
	if !r.summary.HasRoot {
		return nil
	}
	return &SpanResolver{storage: r.storage, owner: r}
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
	items, _, err := r.storage.LogsPageByTraceID(ctx, r.id, nil, 0, "")
	if err != nil {
		return nil, err
	}
	out := make([]*LogResolver, len(items))
	for i := range items {
		out[i] = &LogResolver{storage: r.storage, l: items[i]}
	}
	return out, nil
}

// SpanResolver carries a back-pointer to the owning TraceDetail so span.trace
// and span.parent resolve without re-querying storage.
//
// It has a second, "owner-backed" mode used only for a TraceResolver's
// rootSpan: trace/s are nil and owner points back at the TraceResolver
// instead. Name/Kind/StatusCode/DurationMs are then read straight from
// owner's TraceSummary (the fields TracesPage's SQL already computed), and
// ParentSpanID/TraceID/ServiceName are derivable without a fetch too (a root
// span is parentless by definition, and TraceSummary.ServiceName is already
// the root span's own service — see query_trace.go's summarizeSpans). Only
// fields the summary genuinely doesn't carry (SpanID, StartTime, EndTime,
// StatusMessage, Attributes, Resource, Events, Parent) fall back to
// owner.loadDetail — the same TraceByID call Spans() would trigger anyway,
// just deferred until a query actually asks for one of them.
type SpanResolver struct {
	storage *storage.Storage
	trace   *storage.TraceDetail
	s       *storage.SpanDetail

	owner *TraceResolver
}

// resolve returns the full TraceDetail/SpanDetail backing this resolver,
// lazily loading it through owner when constructed in owner-backed mode.
// span may be nil after a benign Clear/Sweep race (see loadDetail); callers
// must check for that rather than dereferencing blindly.
func (r *SpanResolver) resolve(ctx context.Context) (*storage.TraceDetail, *storage.SpanDetail, error) {
	if r.s != nil {
		return r.trace, r.s, nil
	}
	d, err := r.owner.loadDetail(ctx)
	if err != nil {
		return nil, nil, err
	}
	return d, storage.PickRootSpan(d.Spans), nil
}

func (r *SpanResolver) TraceID() gql.ID {
	if r.s != nil {
		return gql.ID(r.s.TraceID)
	}
	return gql.ID(r.owner.id)
}

func (r *SpanResolver) SpanID(ctx context.Context) (gql.ID, error) {
	_, s, err := r.resolve(ctx)
	if err != nil || s == nil {
		return "", err
	}
	return gql.ID(s.SpanID), nil
}

// ParentSpanID is always "" in owner mode: storage.PickRootSpan only ever selects
// parentless spans, so there is nothing to fetch to answer this.
func (r *SpanResolver) ParentSpanID() string {
	if r.s != nil {
		return r.s.ParentSpanID
	}
	return ""
}

func (r *SpanResolver) Name() string {
	if r.s != nil {
		return r.s.Name
	}
	return r.owner.summary.RootName
}

func (r *SpanResolver) Kind() string {
	if r.s != nil {
		return r.s.Kind
	}
	return r.owner.summary.RootKind
}

// ServiceName in owner mode reads TraceSummary.ServiceName directly: when a
// trace has a root span, tracesPageQuery/summarizeSpans always set the
// trace's ServiceName from that same root span (see query_trace.go), so no
// fetch is needed.
func (r *SpanResolver) ServiceName() string {
	if r.s != nil {
		return r.s.ServiceName
	}
	return r.owner.summary.ServiceName
}

func (r *SpanResolver) StartTime(ctx context.Context) (gql.Time, error) {
	_, s, err := r.resolve(ctx)
	if err != nil || s == nil {
		return gql.Time{}, err
	}
	return gql.Time{Time: s.StartTS}, nil
}

func (r *SpanResolver) EndTime(ctx context.Context) (gql.Time, error) {
	_, s, err := r.resolve(ctx)
	if err != nil || s == nil {
		return gql.Time{}, err
	}
	return gql.Time{Time: s.EndTS}, nil
}

func (r *SpanResolver) DurationMs() float64 {
	if r.s != nil {
		return durationMs(r.s.Duration)
	}
	return durationMs(r.owner.summary.RootDuration)
}

func (r *SpanResolver) StatusCode() string {
	if r.s != nil {
		return r.s.StatusCode
	}
	return r.owner.summary.RootStatusCode
}

func (r *SpanResolver) StatusMessage(ctx context.Context) (string, error) {
	_, s, err := r.resolve(ctx)
	if err != nil || s == nil {
		return "", err
	}
	return s.StatusMessage, nil
}

func (r *SpanResolver) Attributes(ctx context.Context) (JSONMap, error) {
	_, s, err := r.resolve(ctx)
	if err != nil || s == nil {
		return JSONMap{}, err
	}
	return attrsToJSON(s.Attributes), nil
}

func (r *SpanResolver) Resource(ctx context.Context) (JSONMap, error) {
	_, s, err := r.resolve(ctx)
	if err != nil || s == nil {
		return JSONMap{}, err
	}
	return attrsToJSON(s.Resource), nil
}

func (r *SpanResolver) Events(ctx context.Context) ([]*SpanEventResolver, error) {
	_, s, err := r.resolve(ctx)
	if err != nil || s == nil {
		return nil, err
	}
	out := make([]*SpanEventResolver, len(s.Events))
	for i := range s.Events {
		out[i] = &SpanEventResolver{ev: &s.Events[i]}
	}
	return out, nil
}

// Trace is the edge back to the owning trace — always present because spans
// are only ever returned via a Trace in the schema.
func (r *SpanResolver) Trace() *TraceResolver {
	if r.s != nil {
		return newTraceResolverFromDetail(r.storage, r.trace)
	}
	return r.owner
}

// Parent is the edge to the parent span within the same trace. Returns nil
// for root spans (ParentSpanID empty, which every owner-mode span is by
// construction) or when the parent has not been buffered under the same
// trace.
func (r *SpanResolver) Parent() *SpanResolver {
	if r.s == nil || r.s.ParentSpanID == "" {
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
