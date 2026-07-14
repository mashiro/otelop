package graphql

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	gql "github.com/graph-gophers/graphql-go"

	"github.com/google/uuid"
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
	After  *string
	From   *gql.Time
	To     *gql.Time
	Search *string
}

func (r *Resolver) Traces(ctx context.Context, args TracesArgs) (*ConnectionResolver[*TraceResolver], error) {
	from, to := r.resolveWindow(args.From, args.To)
	after, err := decodeTraceCursor(args.After)
	if err != nil {
		return nil, err
	}
	items, hasNextPage, err := r.storage.TracesPage(ctx, from, to, after, int(args.Limit), stringArg(args.Search))
	if err != nil {
		return nil, err
	}
	resolved := make([]*TraceResolver, len(items))
	for i := range items {
		resolved[i] = newTraceResolver(r.storage, items[i])
	}
	return newConnection(resolved, hasNextPage, args.Limit, traceEndCursor(items), func(item *TraceResolver) *TraceResolver { return item }), nil
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
	After  *string
	From   *gql.Time
	To     *gql.Time
	Search *string
}

func (r *Resolver) Metrics(ctx context.Context, args MetricsArgs) (*ConnectionResolver[*MetricResolver], error) {
	from, to := r.resolveWindow(args.From, args.To)
	after, err := decodeMetricCursor(args.After)
	if err != nil {
		return nil, err
	}
	items, hasNextPage, err := r.storage.MetricsPageSearch(ctx, from, to, after, int(args.Limit), stringArg(args.Search))
	if err != nil {
		return nil, err
	}
	return newConnection(items, hasNextPage, args.Limit, metricEndCursor(items), func(m storage.MetricSummary) *MetricResolver {
		return &MetricResolver{storage: r.storage, m: m, from: from, to: to}
	}), nil
}

type LogsArgs struct {
	Limit   int32
	After   *string
	TraceID *string
	From    *gql.Time
	To      *gql.Time
	Search  *string
}

func (r *Resolver) Logs(ctx context.Context, args LogsArgs) (*ConnectionResolver[*LogResolver], error) {
	var (
		items       []storage.LogDetail
		hasNextPage bool
		err         error
	)
	after, err := decodeLogCursor(args.After)
	if err != nil {
		return nil, err
	}
	if args.TraceID != nil && *args.TraceID != "" {
		// The trace-correlation view ignores search, same as it already
		// ignores from/to — it ranges over one trace's logs regardless of
		// time or the traces/logs list's active search box.
		items, hasNextPage, err = r.storage.LogsPageByTraceID(ctx, *args.TraceID, after, int(args.Limit))
	} else {
		from, to := r.resolveWindow(args.From, args.To)
		items, hasNextPage, err = r.storage.LogsPage(ctx, from, to, after, int(args.Limit), stringArg(args.Search))
	}
	if err != nil {
		return nil, err
	}
	return newConnection(items, hasNextPage, args.Limit, logEndCursor(items), func(l storage.LogDetail) *LogResolver {
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

type MetricDistributionStatsArgs struct {
	ServiceName string
	Name        string
	From        *gql.Time
	To          *gql.Time
}

func (r *Resolver) MetricDistributionStats(ctx context.Context, args MetricDistributionStatsArgs) (*DistributionStatsResolver, error) {
	from, to := r.resolveWindow(args.From, args.To)
	stats, err := r.storage.MetricDistributionStats(ctx, args.ServiceName, args.Name, from, to)
	if err != nil || stats == nil {
		return nil, err
	}
	return &DistributionStatsResolver{stats: *stats}, nil
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

// ConnectionResolver is the shared limit+1 pagination response for every
// signal connection. It avoids exact counts on list queries.
type ConnectionResolver[T any] struct {
	items       []T
	hasNextPage bool
	limit       int32
	endCursor   *string
}

func (c *ConnectionResolver[T]) Items() []T         { return c.items }
func (c *ConnectionResolver[T]) HasNextPage() bool  { return c.hasNextPage }
func (c *ConnectionResolver[T]) Limit() int32       { return c.limit }
func (c *ConnectionResolver[T]) EndCursor() *string { return c.endCursor }

// newConnection wraps a storage page into a ConnectionResolver, mapping each
// storage record into its per-type resolver via convert.
func newConnection[T, R any](items []T, hasNextPage bool, limit int32, endCursor *string, convert func(T) R) *ConnectionResolver[R] {
	out := make([]R, len(items))
	for i, v := range items {
		out[i] = convert(v)
	}
	return &ConnectionResolver[R]{
		items:       out,
		hasNextPage: hasNextPage,
		limit:       limit,
		endCursor:   endCursor,
	}
}

type pageCursor struct {
	Signal string `json:"signal"`
	Time   string `json:"time"`
	Tie    string `json:"tie,omitempty"`
	ID     string `json:"id"`
}

func encodeCursor(c pageCursor) *string {
	b, _ := json.Marshal(c)
	value := base64.RawURLEncoding.EncodeToString(b)
	return &value
}

func decodeCursor(raw *string, signal string) (*pageCursor, error) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(*raw)
	if err != nil {
		return nil, fmt.Errorf("invalid %s cursor", signal)
	}
	var c pageCursor
	if err := json.Unmarshal(b, &c); err != nil || c.Signal != signal {
		return nil, fmt.Errorf("invalid %s cursor", signal)
	}
	return &c, nil
}

func cursorTime(value, signal string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid %s cursor", signal)
	}
	return t, nil
}

func decodeLogCursor(raw *string) (*storage.LogCursor, error) {
	c, err := decodeCursor(raw, "logs")
	if err != nil || c == nil {
		return nil, err
	}
	ts, err := cursorTime(c.Time, "logs")
	if err != nil {
		return nil, err
	}
	id, err := uuid.Parse(c.ID)
	if err != nil {
		return nil, fmt.Errorf("invalid logs cursor")
	}
	return &storage.LogCursor{TS: ts, ID: id}, nil
}

func decodeTraceCursor(raw *string) (*storage.TraceCursor, error) {
	c, err := decodeCursor(raw, "traces")
	if err != nil || c == nil {
		return nil, err
	}
	start, err := cursorTime(c.Time, "traces")
	if err != nil {
		return nil, err
	}
	seen, err := cursorTime(c.Tie, "traces")
	if err != nil {
		return nil, err
	}
	return &storage.TraceCursor{StartTime: start, FirstSeen: seen, TraceID: c.ID}, nil
}

func decodeMetricCursor(raw *string) (*storage.MetricCursor, error) {
	c, err := decodeCursor(raw, "metrics")
	if err != nil || c == nil {
		return nil, err
	}
	seen, err := cursorTime(c.Time, "metrics")
	if err != nil {
		return nil, err
	}
	return &storage.MetricCursor{LastSeen: seen, ServiceName: c.Tie, MetricName: c.ID}, nil
}

func logEndCursor(items []storage.LogDetail) *string {
	if len(items) == 0 {
		return nil
	}
	v := items[len(items)-1]
	return encodeCursor(pageCursor{Signal: "logs", Time: v.TS.Format(time.RFC3339Nano), ID: v.ID.String()})
}

func traceEndCursor(items []storage.TraceSummary) *string {
	if len(items) == 0 {
		return nil
	}
	v := items[len(items)-1]
	return encodeCursor(pageCursor{Signal: "traces", Time: v.StartTime.Format(time.RFC3339Nano), Tie: v.FirstSeen.Format(time.RFC3339Nano), ID: v.TraceID})
}

func metricEndCursor(items []storage.MetricSummary) *string {
	if len(items) == 0 {
		return nil
	}
	v := items[len(items)-1]
	return encodeCursor(pageCursor{Signal: "metrics", Time: v.LastSeen.Format(time.RFC3339Nano), Tie: v.ServiceName, ID: v.MetricName})
}
