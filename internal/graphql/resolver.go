package graphql

import (
	"context"
	"time"

	gql "github.com/graph-gophers/graphql-go"

	"github.com/mashiro/otelop/internal/storage"
)

// Resolver is the root resolver for the GraphQL schema. It holds the storage
// reference shared with every sub-resolver so nested fields (e.g. Trace.logs)
// can reach back for correlated data without threading extra state through.
type Resolver struct {
	storage *storage.Storage
	runtime RuntimeInfo
}

// fullWindow is the default time range for traces/metrics/logs queries when
// no explicit from/to args are given: the entire retention window, padded
// with slack on both ends so retention-boundary sweeps and clock skew never
// clip data a caller expects to see. Mirrors the task spec exactly.
func (r *Resolver) fullWindow() (from, to time.Time) {
	now := time.Now()
	const slack = 24 * time.Hour
	return now.Add(-r.runtime.Retention - slack), now.Add(slack)
}

// stringArg unwraps an optional GraphQL string argument to storage's plain
// "" (no-op filter) sentinel, since a nil `search` arg (omitted or explicit
// null) means "no search" the same way an empty string does.
func stringArg(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (r *Resolver) resolveWindow(from, to *gql.Time) (time.Time, time.Time) {
	f, t := r.fullWindow()
	if from != nil {
		f = from.Time
	}
	if to != nil {
		t = to.Time
	}
	return f, t
}

func (r *Resolver) Config(ctx context.Context) (*ConfigResolver, error) {
	traces, metrics, logs, err := r.storage.Counts(ctx)
	if err != nil {
		return nil, err
	}
	return &ConfigResolver{
		storagePath: r.runtime.StoragePath,
		retention:   r.runtime.RetentionDisplay,
		maxSize:     r.runtime.MaxSizeDisplay,
		traceCount:  int32(traces), metricCount: int32(metrics), logCount: int32(logs),
	}, nil
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
func (s *StatusResolver) HTTPAddr() string      { return s.parent.runtime.HTTPAddr }
func (s *StatusResolver) OTLPGrpcAddr() string  { return s.parent.runtime.OTLPGRPCAddr }
func (s *StatusResolver) OTLPHTTPAddr() string  { return s.parent.runtime.OTLPHTTPAddr }
func (s *StatusResolver) ProxyURL() string      { return s.parent.runtime.ProxyURL }
func (s *StatusResolver) ProxyProtocol() string { return s.parent.runtime.ProxyProtocol }
func (s *StatusResolver) Debug() bool           { return s.parent.runtime.Debug }
func (s *StatusResolver) LogLevel() string      { return s.parent.runtime.LogLevel }
func (s *StatusResolver) Config(ctx context.Context) (*ConfigResolver, error) {
	return s.parent.Config(ctx)
}

func (s *StatusResolver) DBSizeBytes(ctx context.Context) (float64, error) {
	stats, err := s.parent.storage.DBStats(ctx)
	if err != nil {
		return 0, err
	}
	return float64(stats.FileSizeBytes), nil
}

type TracesArgs struct {
	Limit  int32
	Offset int32
	From   *gql.Time
	To     *gql.Time
	Search *string
}

func (r *Resolver) Traces(ctx context.Context, args TracesArgs) (*ConnectionResolver[*TraceResolver], error) {
	from, to := r.resolveWindow(args.From, args.To)
	items, total, err := r.storage.TracesPage(ctx, from, to, int(args.Offset), int(args.Limit), stringArg(args.Search))
	if err != nil {
		return nil, err
	}
	return newConnection(items, total, args.Limit, args.Offset, func(t storage.TraceSummary) *TraceResolver {
		return newTraceResolver(r.storage, t)
	}), nil
}

type TraceArgs struct {
	TraceID gql.ID
}

func (r *Resolver) Trace(ctx context.Context, args TraceArgs) (*TraceResolver, error) {
	d, ok, err := r.storage.TraceByID(ctx, string(args.TraceID))
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}
	return newTraceResolverFromDetail(r.storage, d), nil
}

type MetricsArgs struct {
	Limit  int32
	Offset int32
	From   *gql.Time
	To     *gql.Time
	Search *string
}

func (r *Resolver) Metrics(ctx context.Context, args MetricsArgs) (*ConnectionResolver[*MetricResolver], error) {
	from, to := r.resolveWindow(args.From, args.To)
	items, total, err := r.storage.MetricsPageSearch(ctx, from, to, int(args.Offset), int(args.Limit), stringArg(args.Search))
	if err != nil {
		return nil, err
	}
	return newConnection(items, total, args.Limit, args.Offset, func(m storage.MetricSummary) *MetricResolver {
		return &MetricResolver{storage: r.storage, m: m, from: from, to: to}
	}), nil
}

type LogsArgs struct {
	Limit   int32
	Offset  int32
	TraceID *string
	From    *gql.Time
	To      *gql.Time
	Search  *string
}

func (r *Resolver) Logs(ctx context.Context, args LogsArgs) (*ConnectionResolver[*LogResolver], error) {
	var (
		items []storage.LogDetail
		total int
		err   error
	)
	if args.TraceID != nil && *args.TraceID != "" {
		// The trace-correlation view ignores search, same as it already
		// ignores from/to — it ranges over one trace's logs regardless of
		// time or the traces/logs list's active search box.
		items, total, err = r.storage.LogsPageByTraceID(ctx, *args.TraceID, int(args.Offset), int(args.Limit))
	} else {
		from, to := r.resolveWindow(args.From, args.To)
		items, total, err = r.storage.LogsPage(ctx, from, to, int(args.Offset), int(args.Limit), stringArg(args.Search))
	}
	if err != nil {
		return nil, err
	}
	return newConnection(items, total, args.Limit, args.Offset, func(l storage.LogDetail) *LogResolver {
		return &LogResolver{storage: r.storage, l: l}
	}), nil
}

type MetricAggregateArgs struct {
	ServiceName   string
	Name          string
	GroupBy       []string
	BucketSeconds *int32
	From          *gql.Time
	To            *gql.Time
}

func (r *Resolver) MetricAggregate(ctx context.Context, args MetricAggregateArgs) ([]*AggregateSeriesResolver, error) {
	from, to := r.resolveWindow(args.From, args.To)
	// A nil/omitted bucketSeconds becomes 0, storage.MetricAggregate's
	// "auto-size against the real data extent" sentinel (see its doc
	// comment) — never a fixed fallback window computed here.
	var bucket time.Duration
	if args.BucketSeconds != nil {
		bucket = time.Duration(*args.BucketSeconds) * time.Second
	}
	series, err := r.storage.MetricAggregate(ctx, args.ServiceName, args.Name, args.GroupBy,
		bucket, from, to)
	if err != nil {
		return nil, err
	}
	out := make([]*AggregateSeriesResolver, len(series))
	for i := range series {
		out[i] = &AggregateSeriesResolver{series: series[i]}
	}
	return out, nil
}

type MetricPointsArgs struct {
	ServiceName string
	Name        string
	From        *gql.Time
	To          *gql.Time
}

// MetricPoints is the single-metric counterpart to metrics { dataPoints }
// (issue #162): it calls the same storage.MetricPoints + storage.FilterDerivedPoints
// path MetricResolver.DataPoints does, so a metric detail view can fetch just
// the group it's displaying instead of the whole metrics page to extract one
// group client-side (see hooks/use-metric-range-points.ts).
func (r *Resolver) MetricPoints(ctx context.Context, args MetricPointsArgs) ([]*DataPointResolver, error) {
	from, to := r.resolveWindow(args.From, args.To)
	points, err := r.storage.MetricPoints(ctx, args.ServiceName, args.Name, from, to)
	if err != nil {
		return nil, err
	}
	filtered := storage.FilterDerivedPoints(points)
	out := make([]*DataPointResolver, len(filtered))
	for i := range filtered {
		out[i] = &DataPointResolver{dp: filtered[i]}
	}
	return out, nil
}

func (r *Resolver) ClearSignals(ctx context.Context) (bool, error) {
	if err := r.storage.Clear(ctx); err != nil {
		return false, err
	}
	return true, nil
}

// ConfigResolver holds a snapshot of storage configuration and live counts,
// captured once at resolve time so field access doesn't re-query per field.
type ConfigResolver struct {
	storagePath, retention, maxSize   string
	traceCount, metricCount, logCount int32
}

func (c *ConfigResolver) StoragePath() string { return c.storagePath }
func (c *ConfigResolver) Retention() string   { return c.retention }
func (c *ConfigResolver) MaxSize() string     { return c.maxSize }
func (c *ConfigResolver) TraceCount() int32   { return c.traceCount }
func (c *ConfigResolver) MetricCount() int32  { return c.metricCount }
func (c *ConfigResolver) LogCount() int32     { return c.logCount }

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

// newConnection wraps a storage page into a ConnectionResolver, mapping each
// storage record into its per-type resolver via convert.
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
