package graphql

import (
	gql "github.com/graph-gophers/graphql-go"

	"github.com/mashiro/otelop/internal/store"
)

// Resolver is the root resolver for the GraphQL schema. It holds the store
// reference shared with every sub-resolver so nested fields (e.g. Trace.logs)
// can reach back for correlated data without threading extra state through.
type Resolver struct {
	store *store.Store
}

func (r *Resolver) Config() *ConfigResolver {
	tc, mc, lc, mdp := r.store.Capacity()
	tn, mn, ln := r.store.Len()
	return &ConfigResolver{
		traceCap: int32(tc), metricCap: int32(mc), logCap: int32(lc),
		maxDataPoints: int32(mdp),
		traceCount:    int32(tn), metricCount: int32(mn), logCount: int32(ln),
	}
}

type TracesArgs struct {
	Limit  int32
	Offset int32
}

func (r *Resolver) Traces(args TracesArgs) *TraceConnectionResolver {
	items, total := r.store.GetTracesPage(int(args.Offset), int(args.Limit))
	return &TraceConnectionResolver{
		store:  r.store,
		items:  items,
		total:  int32(total),
		limit:  args.Limit,
		offset: args.Offset,
	}
}

type TraceArgs struct {
	TraceID gql.ID
}

func (r *Resolver) Trace(args TraceArgs) *TraceResolver {
	t, ok := r.store.GetTraceByID(string(args.TraceID))
	if !ok {
		return nil
	}
	return &TraceResolver{store: r.store, t: t}
}

type MetricsArgs struct {
	Limit  int32
	Offset int32
}

func (r *Resolver) Metrics(args MetricsArgs) *MetricConnectionResolver {
	items, total := r.store.GetMetricsPage(int(args.Offset), int(args.Limit))
	return &MetricConnectionResolver{
		items:  items,
		total:  int32(total),
		limit:  args.Limit,
		offset: args.Offset,
	}
}

type LogsArgs struct {
	Limit   int32
	Offset  int32
	TraceID *string
}

func (r *Resolver) Logs(args LogsArgs) *LogConnectionResolver {
	var (
		items []*store.LogData
		total int
	)
	if args.TraceID != nil && *args.TraceID != "" {
		items, total = r.store.GetLogsPageByTraceID(*args.TraceID, int(args.Offset), int(args.Limit))
	} else {
		items, total = r.store.GetLogsPage(int(args.Offset), int(args.Limit))
	}
	return &LogConnectionResolver{
		store:  r.store,
		items:  items,
		total:  int32(total),
		limit:  args.Limit,
		offset: args.Offset,
	}
}

func (r *Resolver) ClearSignals() bool {
	r.store.Clear()
	return true
}

// ConfigResolver holds a snapshot of capacity and live counts. Values are
// captured once at resolve time so the fields don't re-lock the store on
// every field access.
type ConfigResolver struct {
	traceCap, metricCap, logCap, maxDataPoints int32
	traceCount, metricCount, logCount          int32
}

func (c *ConfigResolver) TraceCap() int32      { return c.traceCap }
func (c *ConfigResolver) MetricCap() int32     { return c.metricCap }
func (c *ConfigResolver) LogCap() int32        { return c.logCap }
func (c *ConfigResolver) MaxDataPoints() int32 { return c.maxDataPoints }
func (c *ConfigResolver) TraceCount() int32    { return c.traceCount }
func (c *ConfigResolver) MetricCount() int32   { return c.metricCount }
func (c *ConfigResolver) LogCount() int32      { return c.logCount }

type TraceConnectionResolver struct {
	store  *store.Store
	items  []*store.TraceData
	total  int32
	limit  int32
	offset int32
}

func (c *TraceConnectionResolver) Items() []*TraceResolver {
	out := make([]*TraceResolver, len(c.items))
	for i, t := range c.items {
		out[i] = &TraceResolver{store: c.store, t: t}
	}
	return out
}

func (c *TraceConnectionResolver) Total() int32  { return c.total }
func (c *TraceConnectionResolver) Limit() int32  { return c.limit }
func (c *TraceConnectionResolver) Offset() int32 { return c.offset }

type MetricConnectionResolver struct {
	items  []*store.MetricData
	total  int32
	limit  int32
	offset int32
}

func (c *MetricConnectionResolver) Items() []*MetricResolver {
	out := make([]*MetricResolver, len(c.items))
	for i, m := range c.items {
		out[i] = &MetricResolver{m: m}
	}
	return out
}

func (c *MetricConnectionResolver) Total() int32  { return c.total }
func (c *MetricConnectionResolver) Limit() int32  { return c.limit }
func (c *MetricConnectionResolver) Offset() int32 { return c.offset }

type LogConnectionResolver struct {
	store  *store.Store
	items  []*store.LogData
	total  int32
	limit  int32
	offset int32
}

func (c *LogConnectionResolver) Items() []*LogResolver {
	out := make([]*LogResolver, len(c.items))
	for i, l := range c.items {
		out[i] = &LogResolver{store: c.store, l: l}
	}
	return out
}

func (c *LogConnectionResolver) Total() int32  { return c.total }
func (c *LogConnectionResolver) Limit() int32  { return c.limit }
func (c *LogConnectionResolver) Offset() int32 { return c.offset }
