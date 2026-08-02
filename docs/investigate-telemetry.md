---
description: Investigate traces, metrics, and logs stored by otelop through its GraphQL API. Use when debugging an instrumented application, correlating signals, or querying exact telemetry values.
---
# Investigate telemetry

otelop exposes retained traces, metrics, and logs through an introspectable
GraphQL API. Use this workflow:

1. Discover the running instance with `otelop status`.
2. Choose a narrow time window and, when useful, a text search.
3. Use a list query to find relevant signals.
4. Fetch detail only for the selected trace or metric.
5. Follow pagination when the answer must be exhaustive.

## Connect to the API

Read the Web UI address from `otelop status`; do not assume the default port.
The default GraphQL endpoint is `http://localhost:4319/graphql`.

```sh
curl -sS -X POST http://localhost:4319/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ status { version uptimeMs dbSizeBytes } }"}'
```

Top-level queries are:

- `status` and `config` for runtime, ingestion counts, and storage pressure.
- `traces(...)` and `trace(traceId:)` for traces and spans.
- `metrics(...)` and `metricPoints(...)` for metric summaries and history.
- `metricAggregate(...)` and `metricDistributionStats(...)` for grouped metric
  series and histogram statistics.
- `logs(...)` for log records and trace/span correlation.

Request only the fields needed. In particular, do not request
`Metric.dataPoints` for every item on a large metrics page.

## Set the time window

`Time` values are RFC3339 strings. `from` is inclusive and `to` is exclusive:

```json
{
  "from": "2026-08-02T06:07:00Z",
  "to": "2026-08-02T06:12:00Z"
}
```

`2026-08-02T15:07:00+09:00` and `2026-08-02T06:07:00Z` represent the same
instant. `otelop status` displays `Started` in the machine's local timezone,
while stored telemetry timestamps returned by GraphQL use UTC with `Z`.
Convert the instant rather than copying its clock fields.

Time-window membership differs by signal:

- A trace is selected by its `startTime`, the earliest retained span start.
- A log is selected by its record timestamp.
- A metric group is selected when any attribute series overlaps the window.

## Search and filter

`search` performs a case-insensitive literal substring match. `%` and `_` are
ordinary characters, not wildcards.

| Query | Fields searched |
| --- | --- |
| `traces` | trace ID, every retained span name, span status code, resource service name |
| `metrics` | metric name, service name, metric type, description |
| `logs` | body, resource service name, severity text, trace ID |

There are no dedicated service, trace-error, or log-severity arguments.
Searching traces for `error` can match an `Error` span status, but it is not an
exact `hasError` filter. A service-name search may also match another searched
field. Use a narrow time window and `search` to reduce the result, then apply
exact filtering client-side when necessary.

## Investigate traces

Scan summaries first:

```graphql
query($from: Time!, $to: Time!, $search: String) {
  traces(limit: 100, from: $from, to: $to, search: $search) {
    hasNextPage
    endCursor
    items {
      traceId startTime serviceName durationMs hasError spanCount
      rootSpan { name }
    }
  }
}
```

Then fetch only the selected trace:

```graphql
query($id: ID!) {
  trace(traceId: $id) {
    traceId startTime durationMs hasError
    spans {
      spanId parentSpanId name kind startTime durationMs
      statusCode statusMessage attributes
    }
    logs { timestamp severityNumber severityText body attributes }
  }
}
```

## Investigate metrics

### Read an overview

Use `latestValue` and `pointCount` when a summary or current glance value is
enough. The server resolves both for the whole page without returning point
history:

```graphql
{
  metrics(limit: 20, search: "store") {
    items { serviceName name type unit latestValue pointCount receivedAt }
  }
}
```

The fields have different time semantics:

| Field | Meaning |
| --- | --- |
| `pointCount` | Number of derived points across all attribute series inside the requested `from`/`to` window. |
| `latestValue` | Derived value of the newest retained observation from the group's most recently active series, regardless of `from`/`to`. It is not an aggregation across attribute series. |

`latestValue` is null when no meaningful value can be derived, including a
baseline-only cumulative monotonic Sum or cumulative distribution, or a
distribution observation without a derivable average. Do not use it to report
a value inside a historical window.

### Read exact history

Use `metricPoints` when individual observations or a value inside a specific
window is required:

```graphql
query($service: String!, $name: String!, $from: Time!, $to: Time!) {
  metricPoints(serviceName: $service, name: $name, from: $from, to: $to) {
    timestamp value cumulative count countCumulative
    sum sumCumulative min max attributes
  }
}
```

Interpret point fields by metric type:

| Type | `value` | Other fields |
| --- | --- | --- |
| Gauge | Instantaneous sample. | The cumulative and distribution fields are null. |
| Sum | A delta Sum is already an interval value. A cumulative monotonic Sum is delta-derived. A cumulative non-monotonic Sum is returned as its source value. | For a monotonic Sum, `cumulative` is the exporter total for cumulative input. Delta-input totals are window-dependent as described below. |
| Histogram, Summary, ExponentialHistogram | Interval arithmetic mean (`sum / count`), or `0` when no average can be derived. Inspect `count` and `sum` before interpreting zero. | `count` and `sum` are interval deltas. `min` and `max` are sender-reported point extrema and are not delta-derived. |

For delta-temporality inputs, cumulative fields are window-dependent. The
running total starts at the selected GraphQL time window, so do not interpret
it as a retained-lifetime total. For cumulative-temporality inputs, cumulative
fields preserve the exporter's raw values.

A `(serviceName, name)` group can contain multiple attribute series.
`metricPoints` interleaves them in one timestamp-ordered list, and multiple
points can share a timestamp. Request `attributes` to distinguish different
point-attribute sets before calculating a latest value or trend.

Point attributes do not uniquely identify every underlying series. Resource
identity and instrumentation scope can create independent series with identical
point attributes, and `metricPoints` does not expose that per-point identity.
Such series cannot be separated through the current GraphQL API. Use
`metricAggregate` or `metricDistributionStats` when their server-side
cross-series combination matches the required result.

Use `metricAggregate` instead for server-side time buckets or attribute
grouping. Its `groupBy` list must contain at least one point-attribute name:

```graphql
query($service: String!, $name: String!, $from: Time!, $to: Time!) {
  metricAggregate(
    serviceName: $service
    name: $name
    groupBy: ["signal"]
    from: $from
    to: $to
  ) {
    groupValues
    points { timestamp value count sum min max }
  }
}
```

Set `bucketSeconds` to choose a fixed time-bucket width. When it is omitted,
otelop targets approximately 150 buckets across the metric's actual data
extent inside the requested window, rather than across the entire `from`/`to`
range.

Interpret aggregate values by metric type:

- Gauge: mean over time within each underlying series, then sum across series.
- Sum: delta and cumulative monotonic inputs are summed as interval values
  across series. Cumulative non-monotonic inputs are summed as their raw source
  values.
- Histogram, Summary, and ExponentialHistogram: total interval sum divided by
  total interval count. The returned value is `0` when no average can be
  derived; inspect `count` and `sum` before interpreting zero.

Aggregate `min` and `max` are reductions of sender-reported point extrema; they
are not delta-derived. For cumulative distributions, they can therefore still
describe cumulative point extrema while `count` and `sum` describe intervals.

A series missing a requested `groupBy` attribute contributes to the empty
string (`""`) group instead of being dropped.

### Read histogram statistics

Use `metricDistributionStats` for merged Histogram and ExponentialHistogram
statistics:

```graphql
query($service: String!, $name: String!, $from: Time!, $to: Time!) {
  metricDistributionStats(
    serviceName: $service
    name: $name
    from: $from
    to: $to
  ) {
    groupValues attributes count mean min max p50 p90 p95 p99
  }
}
```

Unlike `metricAggregate`, its `groupBy` argument is optional. Omitting it
groups by each complete point-attribute map. Summary quantiles cannot be merged
across points or attribute series, so a Summary metric returns no groups.
Percentiles are estimates interpolated from the sender's retained bucket
boundaries; coarse bucket layouts produce coarse estimates, not exact observed
values, and can look inconsistent with independently reduced `min` or `max`.

## Investigate logs

```graphql
query($from: Time!, $to: Time!, $search: String) {
  logs(limit: 100, from: $from, to: $to, search: $search) {
    hasNextPage
    endCursor
    items {
      id timestamp severityNumber severityText body serviceName traceId spanId
      trace { traceId hasError durationMs }
      span { spanId name statusCode }
    }
  }
}
```

`severityText` can be empty when the exporter does not set it. Request
`severityNumber` as well; `0` means unspecified. Grouping or filtering only by
non-empty severity text silently omits such records.

To retrieve every retained log correlated with one trace, query from the logs
side with `traceId`:

```graphql
query($traceId: String!) {
  logs(limit: 100, traceId: $traceId) {
    hasNextPage
    endCursor
    items {
      id timestamp severityNumber severityText body serviceName spanId
      span { spanId name statusCode }
    }
  }
}
```

When a non-empty `traceId` is supplied, `from` and `to` are ignored so the
query covers the trace's retained lifetime. `search` can still be supplied and
is applied together with the trace ID.

## Paginate complete results

The `traces`, `metrics`, and `logs` connections return `items`, `hasNextPage`,
`endCursor`, and `limit`. Pass `endCursor` as `after` for the next page. Start
again without `after` after changing any filter, including the time window,
search, or log `traceId`.

Do not describe a partial page as the complete result. Continue until
`hasNextPage` is false when the question requires an exhaustive count or a
claim that no matching signal exists.

## Safety

Prefer read-only surfaces: `otelop status`, GraphQL queries, and the browser UI.
Do not start, restart, or stop otelop without the user's permission.

The `clearSignals` mutation irreversibly deletes every retained signal. Never
call it without an explicit user request.
