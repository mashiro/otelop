---
name: otelop-inspect
description: Investigate OpenTelemetry signals (traces, metrics, logs) retained by a locally running otelop instance via its GraphQL API. Use this when the user is debugging an app that sends telemetry to otelop and you need to inspect spans, correlate logs with traces, or read metric values.
---

# Investigating with otelop's GraphQL API

otelop stores received telemetry in DuckDB and exposes it at
`http://localhost:4319/graphql` by default. The HTTP address is configurable.
Prefer public surfaces (`otelop status`, `/graphql`, and the browser
UI) over implementation details.

## Verify the server

Run:

```bash
otelop status
```

To verify GraphQL itself:

```bash
curl -sS -X POST http://localhost:4319/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ status { version uptimeMs dbSizeBytes config { traceCount metricCount logCount retention maxSize } } }"}'
```

A connection error means the configured server is not reachable. Check the
address reported by `otelop status`; do not assume the daemon should be
started or restart it without the user's permission.

## Choose a focused query

- Runtime and ingestion overview: `status` and `config`.
- Storage performance: inspect `otelop.duckdb.query.duration`,
  `otelop.duckdb.write.duration`, `otelop.duckdb.write.rows`,
  `otelop.storage.commit.duration`, `otelop.storage.queue.depth`, and
  `otelop.storage.queue.dropped`. Query metrics use the `operation` attribute;
  write/commit metrics use `signal`; queue metrics use `queue` and, for drops,
  `signal`.
- Storage pipeline detail: search recent traces for `storage.writeTraces`,
  `storage.writeMetrics`, or `storage.writeLogs`, then fetch the selected trace's
  spans. The trace connects `exporter.push*`, conversion, writer queue wait,
  upsert/dedup/append, commit queue wait, read-back queries, broadcast, and
  WebSocket queue/dispatch. Compare `storage.queue.wait_ms` on
  `storage.queue.wait` and `storage.deliverCommit`, then inspect the longest
  function span. Self-telemetry ingestion is deliberately not re-instrumented.
- Recent traces or errors: `traces` with `startTime`, `hasError`, and
  `durationMs`, followed by `trace(traceId:)` for detail.
- Missing or abruptly removed traces: search logs for
  `dropped oversized trace`. A trace is deleted atomically when its retained
  span count crosses 10,000; later spans for the same trace are ignored while
  its tombstone remains live. The tombstone expires only after no spans for
  that trace have arrived for a full retention period.
- Logs: `logs` with a narrow time window and `search`; traverse `trace` or
  `span` when correlation matters.
- Metric existence/list view: `metrics` with `latestValue` and `pointCount`.
- Exact metric history: `metricPoints(serviceName:, name:, from:, to:)`.
- Chart/facet data: `metricAggregate(serviceName:, name:, groupBy:, ...)`.
- Histogram window statistics: `metricDistributionStats(serviceName:, name:,
  groupBy:, from:, to:)`.

Request only the fields needed. Avoid `Metric.dataPoints` on every item in a
large metrics page; use `metricPoints` after choosing one metric.

## Current schema overview

The schema is introspectable:

```graphql
{ __schema { queryType { fields { name description args { name type { name ofType { name } } } } } } }
```

Top-level queries:

- `status: Status!`
- `config: Config!`
- `traces(limit: 50, after: String, from: Time, to: Time, search: String)`
- `trace(traceId: ID!): Trace`
- `metrics(limit: 50, after: String, from: Time, to: Time, search: String)`
- `metricPoints(serviceName: String!, name: String!, from: Time, to: Time)`
- `metricAggregate(serviceName: String!, name: String!, groupBy: [String!]!, bucketSeconds: Int, from: Time, to: Time)`
- `metricDistributionStats(serviceName: String!, name: String!, groupBy: [String!], from: Time, to: Time)`
- `logs(limit: 50, after: String, traceId: String, from: Time, to: Time, search: String)`

All three signal connections return `items`, `hasNextPage`, `endCursor`, and
`limit`; pass `endCursor` as the next query's `after` value. A changed time
window or search starts again without `after`. List queries deliberately do
not count every match. Their `search` is a case-insensitive literal
substring match; `%` and `_` are not wildcards. `from` is inclusive and `to`
is exclusive.

Time-window semantics differ by list:

- Traces use trace `startTime`, the earliest retained span start, and sort by
  that value descending.
- Logs use the log timestamp and sort descending.
- Metrics include a `(serviceName, name)` group when any series lifetime
  overlaps the window, and sort groups by their latest received point.

`config` reports storage configuration plus logical counts: retained traces,
distinct `(serviceName, metric name)` groups, and log records. It does not
report capacities. `status.dbSizeBytes`, `config.retention`, and
`config.maxSize` describe storage pressure.

Mutation `clearSignals` deletes every retained signal and is irreversible.
Never call it without an explicit user request.

## Types that matter

- `Trace`: `traceId`, `serviceName`, `rootSpan`, `spans`, `spanCount`,
  `startTime`, `durationMs`, `hasError`, `logs`.
- `Span`: IDs, name/kind/service, start/end/duration, status, attributes,
  events, resource, `trace`, and `parent`.
- `Metric`: name/description/unit/type/service/resource, `dataPoints`,
  `pointCount`, `latestValue`, and `receivedAt`.
- `DataPoint`: `id`, `timestamp`, `value`, `cumulative`, `count`,
  `countCumulative`, `sum`, `sumCumulative`, `min`, `max`, and `attributes`.
- `DistributionSeries`: one attribute breakdown's `groupValues` (or complete
  `attributes` when `groupBy` is omitted), window-wide `count` and `mean`,
  point-reduced optional `min` and `max`, and bucket-estimated `p50`, `p90`,
  `p95`, `p99` for Histogram and ExponentialHistogram metrics.
- `Log`: `id`, timestamps, trace/span IDs, severity, body, service,
  attributes/resource, `trace`, and `span`.

Graph edges can be fetched in one round-trip. A nullable correlation edge is
null when its ID is absent or the referenced retained row no longer exists.

## Query cookbook

### Scan traces, then drill in

```graphql
query($from: Time, $to: Time, $search: String) {
  traces(limit: 100, from: $from, to: $to, search: $search) {
    hasNextPage
    endCursor
    items { traceId startTime serviceName durationMs hasError spanCount rootSpan { name } }
  }
}
```

```graphql
query($id: ID!) {
  trace(traceId: $id) {
    traceId startTime durationMs hasError
    spans {
      spanId parentSpanId name kind startTime durationMs statusCode statusMessage
      attributes events { name timestamp attributes }
    }
    logs { timestamp severityText body attributes }
  }
}
```

### Search logs and inspect their surroundings

```graphql
query($from: Time!, $to: Time!, $search: String) {
  logs(limit: 100, from: $from, to: $to, search: $search) {
    hasNextPage
    endCursor
    items {
      id timestamp severityText body serviceName
      trace { traceId hasError durationMs }
      span { spanId name statusCode }
    }
  }
}
```

To show surrounding records, choose a new `[from, to)` around the selected
log timestamp and query again. `logs(traceId:)` instead returns all retained
logs for that trace and ignores `from`, `to`, and `search`.

### List metrics, then read one metric

```graphql
query($from: Time, $to: Time, $search: String) {
  metrics(limit: 100, from: $from, to: $to, search: $search) {
    hasNextPage
    endCursor
    items { serviceName name type unit receivedAt latestValue pointCount }
  }
}
```

```graphql
query($service: String!, $name: String!, $from: Time!, $to: Time!) {
  metricPoints(serviceName: $service, name: $name, from: $from, to: $to) {
    id timestamp value cumulative count countCumulative
    sum sumCumulative min max attributes
  }
}
```

For histogram percentiles, request the server-side merged distribution rather
than calculating or averaging percentiles from individual points:

```graphql
query($service: String!, $name: String!, $groupBy: [String!], $from: Time!, $to: Time!) {
  metricDistributionStats(
    serviceName: $service
    name: $name
    groupBy: $groupBy
    from: $from
    to: $to
  ) {
    groupValues attributes count mean min max p50 p90 p95 p99
  }
}
```

Pass the same attribute keys used by the chart breakdown. Omit `groupBy` to
group by each complete point-attribute map, reproducing the UI's `All` view.
Each underlying series is delta-derived before its buckets are merged into a
returned group. `min` and `max` instead reduce the optional values carried by
the selected points and are not delta-derived for cumulative histograms.
Percentiles are estimates interpolated from the sender's retained bucket
boundaries. If the boundaries are much wider than the observed values, the
reported percentiles will be correspondingly coarse and can fall outside the
independently reduced point `min`/`max`. Compare `mean`, `min`, and `max` with
`metricPoints` before treating an implausible percentile as storage
corruption; the instrument's histogram boundaries may need adjustment.

Data points are ordered oldest-first. One metric group can contain multiple
attribute series, so group points by `attributes` before reporting a latest
value or trend.

For Gauge, `value` is instantaneous. For Sum, it is the interval value (a
cumulative monotonic source is delta-derived). For Histogram, Summary, and
ExponentialHistogram, `value` is the interval arithmetic mean (`sum/count`),
while `count`, `sum`, `min`, and `max` expose distribution statistics when
available. The cumulative fields either preserve source cumulative values or
accumulate retained delta inputs. Retention/max-size cleanup can change totals
derived from retained delta history.

## Investigation playbook

1. Query `status { config { ... } dbSizeBytes }` to confirm the server and
   whether relevant signal groups exist.
2. Use server-side `from`/`to` and `search` to narrow the response before
   requesting large JSON attribute fields.
3. Scan traces by `startTime`, `hasError`, and `durationMs`, then fetch one
   trace with spans and correlated logs.
4. For a metric, list with `latestValue`, then fetch its exact history with
   `metricPoints` or server-bucketed chart data with `metricAggregate`.
5. Report trace IDs and exact RFC3339 windows so the result is reproducible
   in the UI or another query.
6. If an expected trace is absent or disappears while ingest is active, search
   logs for `dropped oversized trace` and report its `trace_id`, `span_count`,
   and `limit` attributes before attributing the loss to retention.

## Common pitfalls

- Times use the GraphQL `Time` scalar and RFC3339 values. Durations ending in
  `Ms` are milliseconds.
- Attributes and resources are free-form JSON and can be large.
- A trace list window is based on trace start, not the timestamps of every
  contained span.
- `pointCount` is cardinality, not metric state; use `latestValue` or
  `metricPoints` for values.
- Histogram percentile accuracy is bounded by the sender's bucket layout. A
  duration Histogram recorded in seconds with broad default boundaries can
  legitimately return multi-second bucket estimates for millisecond-scale
  observations; inspect `metricPoints` and the metric unit when results look
  implausible.
- Missing old data may be caused by configured retention or max-size cleanup.
  A trace can also disappear when it crosses the 10,000 retained-span limit;
  confirm this through the `dropped oversized trace` warning log. There is no
  ring-buffer capacity to compare against.
- `clearSignals` is destructive and has no undo.
