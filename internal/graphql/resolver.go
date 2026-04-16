package graphql

import (
	"time"

	gql "github.com/graph-gophers/graphql-go"

	"github.com/mashiro/otelop/internal/store"
)

// Resolver is the root resolver for the GraphQL schema. It holds the store
// reference shared with every sub-resolver so nested fields (e.g. Trace.logs)
// can reach back for correlated data without threading extra state through.
type Resolver struct {
	store   *store.Store
	runtime RuntimeInfo
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

func (r *Resolver) Status() *StatusResolver {
	return &StatusResolver{parent: r}
}

type StatusResolver struct {
	parent *Resolver
}

func (s *StatusResolver) Version() string     { return s.parent.runtime.Version }
func (s *StatusResolver) StartedAt() gql.Time { return gql.Time{Time: s.parent.runtime.StartedAt} }
func (s *StatusResolver) UptimeMs() float64 {
	return float64(time.Since(s.parent.runtime.StartedAt).Milliseconds())
}
func (s *StatusResolver) HTTPAddr() string        { return s.parent.runtime.HTTPAddr }
func (s *StatusResolver) OTLPGrpcAddr() string    { return s.parent.runtime.OTLPGRPCAddr }
func (s *StatusResolver) OTLPHTTPAddr() string    { return s.parent.runtime.OTLPHTTPAddr }
func (s *StatusResolver) ProxyURL() string        { return s.parent.runtime.ProxyURL }
func (s *StatusResolver) ProxyProtocol() string   { return s.parent.runtime.ProxyProtocol }
func (s *StatusResolver) Debug() bool             { return s.parent.runtime.Debug }
func (s *StatusResolver) Config() *ConfigResolver { return s.parent.Config() }

type TracesArgs struct {
	Limit  int32
	Offset int32
}

func (r *Resolver) Traces(args TracesArgs) *ConnectionResolver[*TraceResolver] {
	items, total := r.store.GetTracesPage(int(args.Offset), int(args.Limit))
	return newConnection(items, total, args.Limit, args.Offset, func(t *store.TraceData) *TraceResolver {
		return &TraceResolver{store: r.store, t: t}
	})
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

func (r *Resolver) Metrics(args MetricsArgs) *ConnectionResolver[*MetricResolver] {
	items, total := r.store.GetMetricsPage(int(args.Offset), int(args.Limit))
	return newConnection(items, total, args.Limit, args.Offset, func(m *store.MetricData) *MetricResolver {
		return &MetricResolver{m: m}
	})
}

type LogsArgs struct {
	Limit   int32
	Offset  int32
	TraceID *string
}

func (r *Resolver) Logs(args LogsArgs) *ConnectionResolver[*LogResolver] {
	var (
		items []*store.LogData
		total int
	)
	if args.TraceID != nil && *args.TraceID != "" {
		items, total = r.store.GetLogsPageByTraceID(*args.TraceID, int(args.Offset), int(args.Limit))
	} else {
		items, total = r.store.GetLogsPage(int(args.Offset), int(args.Limit))
	}
	return newConnection(items, total, args.Limit, args.Offset, func(l *store.LogData) *LogResolver {
		return &LogResolver{store: r.store, l: l}
	})
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

// ConnectionResolver is the generic paginated-list response shared by
// traces/metrics/logs. Instantiated per element type via newConnection.
type ConnectionResolver[T any] struct {
	items  []T
	total  int32
	limit  int32
	offset int32
}

func (c *ConnectionResolver[T]) Items() []T    { return c.items }
func (c *ConnectionResolver[T]) Total() int32  { return c.total }
func (c *ConnectionResolver[T]) Limit() int32  { return c.limit }
func (c *ConnectionResolver[T]) Offset() int32 { return c.offset }

// newConnection wraps a store page into a ConnectionResolver, mapping each
// store record into its per-type resolver via convert.
func newConnection[T, R any](items []T, total int, limit, offset int32, convert func(T) R) *ConnectionResolver[R] {
	out := make([]R, len(items))
	for i, v := range items {
		out[i] = convert(v)
	}
	return &ConnectionResolver[R]{
		items:  out,
		total:  int32(total),
		limit:  limit,
		offset: offset,
	}
}
