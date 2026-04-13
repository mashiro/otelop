---
name: otelop-api
description: Investigate OpenTelemetry signals (traces, metrics, logs) buffered by a locally running otelop instance via its GraphQL API. Use this when the user is debugging an app that sends telemetry to otelop and you need to inspect spans, correlate logs with traces, or read metric values.
---

# Investigating with otelop's GraphQL API

`otelop` buffers every trace, metric, and log it receives in bounded ring
buffers and exposes them at **`http://localhost:4319/graphql`** (the HTTP port
is configurable, but 4319 is the default). When the user is debugging an app
that points its OTLP exporter at otelop, this skill lets you pull exactly the
signals you need without bothering them for screenshots or log dumps.

Before querying, verify otelop is actually running:

```bash
curl -sS -X POST http://localhost:4319/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ config { traceCap } }"}'
```

A connection error (or anything other than a `{"data":{...}}` envelope) means
otelop is not up — ask the user to start it (`mise run dev` or `otelop start`)
before retrying.

## Picking the right query for the question

The biggest mistake is under-fetching to "save round-trips" when the user
asked for state. Match the query to the question:

| User asks…                                  | Default query                                              |
|---------------------------------------------|------------------------------------------------------------|
| "is otelop running?" / "anything coming in?"| `config { *Cap *Count }`                                   |
| "what's the state of metrics?" / "values?"  | `metrics { items { name unit type dataPoints { value attributes } } }` — fetch values |
| "do we even have metric X?"                 | `metrics { items { name pointCount } }` — pointCount only  |
| "what traces / errors do we have?"          | `traces { items { traceId hasError durationMs rootSpan { name } } }` |
| "drill into trace T"                        | `trace(traceId: T) { spans { ... } logs { ... } }` (one round-trip) |
| "what logs go with this trace?"             | Same `trace(traceId: T) { logs { ... } }` join             |

`pointCount` is a **cardinality probe**, not a state read. If the user said
"状態" / "state" / "values" / "what are they doing", fetch `dataPoints`.

## Schema overview

The schema is introspectable:

```graphql
{ __schema { queryType { fields { name args { name type { name ofType { name } } } } } } }
```

Top-level:

- `config: Config!` — capacities (`traceCap`, `metricCap`, `logCap`,
  `maxDataPoints`) and current counts (`traceCount`, `metricCount`,
  `logCount`).
- `traces(limit=50, offset=0): TraceConnection!` / `trace(traceId: ID!): Trace`
- `metrics(limit=50, offset=0): MetricConnection!`
- `logs(limit=50, offset=0, traceId: String): LogConnection!`
- Mutation `clearSignals: Boolean!` — drops every buffered signal.
  **Destructive**; never call without explicit user permission.

All connections expose `{ items, total, limit, offset }`. Lists are
newest-first.

### Types

**`Trace`**: `traceId`, `serviceName`, `rootSpan: Span`, `spans: [Span!]!`,
`spanCount`, `startTime`, `durationMs`, `hasError` (precomputed; true if any
span has `statusCode == "Error"`), `logs: [Log!]!` (correlation join).

**`Span`**: `traceId`, `spanId`, `parentSpanId`, `name`, `kind`,
`serviceName`, `startTime`, `endTime`, `durationMs`, `statusCode`,
`statusMessage`, `attributes: JSON!`, `events: [SpanEvent!]!`, `resource`,
`trace: Trace!`, `parent: Span`.

**`SpanEvent`**: `name`, `timestamp`, `attributes`.

**`Metric`**: `name`, `description`, `unit`, `type`, `serviceName`,
`resource`, `dataPoints: [DataPoint!]!`, `pointCount: Int!`, `receivedAt`.
`type` is one of `Gauge` / `Sum` / `Histogram` / `Summary` /
`ExponentialHistogram`. Histogram / Summary / ExponentialHistogram only
expose `Count` via `value` — percentile/quantile analysis is out of scope,
see the "Things that bite" section.

**`DataPoint`**: `timestamp`, `value: Float!`, `attributes: JSON!`. Multiple
series for the same metric are mixed into the same `dataPoints` list,
distinguished only by `attributes` — see "Series grouping" below.

**`Log`**: `timestamp`, `observedTimestamp`, `traceId`, `spanId`,
`severityNumber`, `severityText`, `body`, `serviceName`, `attributes`,
`resource`, `trace: Trace`, `span: Span`.

### Graph edges (traversal)

Every type exposes traversable edges so you can follow relationships in one
round-trip:

- `Log.trace: Trace` / `Log.span: Span` — null if traceId/spanId is unset or
  the referent has been evicted.
- `Span.trace: Trace!` / `Span.parent: Span` — parent span within the same
  trace; null for root.
- `Trace.rootSpan: Span` / `Trace.spans: [Span!]!` / `Trace.logs: [Log!]!`.

Raw scalars (`Log.traceId`, `Span.parentSpanId`, …) remain available when you
want just the ID without fetching the referent.

## How to invoke

### 1. Plain HTTP POST (always works)

```bash
curl -sS -X POST http://localhost:4319/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query": "{ traces(limit: 20) { items { traceId hasError durationMs rootSpan { name } } } }"}'
```

For variables:

```bash
curl -sS -X POST http://localhost:4319/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"query($id: ID!){ trace(traceId:$id){ spanCount } }","variables":{"id":"02000000000000000000000000000000"}}'
```

### 2. MCP (when registered)

otelop also mounts its MCP server at `http://localhost:4319/mcp` and exposes
a single tool `query` that takes `{query, variables?, operationName?}`.
otelop is **not** always running, so the MCP server is only reachable while
the process is up.

## Query cookbook

### Traces — scan, then drill

```graphql
{ traces(limit: 100) {
    total
    items { traceId serviceName rootSpan { name } durationMs hasError spanCount }
} }
```

Sort the response yourself: `hasError: true` first, then `durationMs` desc,
to surface candidates.

```graphql
query($id: ID!) {
  trace(traceId: $id) {
    traceId serviceName durationMs hasError
    spans {
      spanId parentSpanId name kind durationMs statusCode statusMessage
      attributes
      events { name timestamp attributes }
    }
    logs { timestamp severityText body attributes }
  }
}
```

### Logs — list, or filter by trace

```graphql
{ logs(limit: 50) {
    items { timestamp severityText body
            trace { traceId hasError durationMs }
            span { spanId name durationMs statusCode } }
} }
```

```graphql
{ logs(traceId: "02000000000000000000000000000000", limit: 200) {
    items { timestamp severityText body }
} }
```

### Metrics — read actual values (the default)

```graphql
{ metrics(limit: 100) {
    items {
      name type unit description serviceName
      dataPoints { timestamp value attributes }
    }
} }
```

After fetching, **group `dataPoints` by `attributes`** to recover series.
Then for each series, take the latest (last element — newest-first) for
"current value", or scan the whole list for min/max/trend.

```python
# pseudo-code: per metric, per series, latest value
series = {}
for p in metric["dataPoints"]:
    key = json.dumps(p["attributes"], sort_keys=True)
    series.setdefault(key, []).append(p)
for key, points in series.items():
    latest = points[-1]["value"]
```

### Metrics — cheap existence check

Only when you literally just want "does this metric exist and how big is it":

```graphql
{ metrics(limit: 100) { items { name type pointCount } } }
```

### Capacity + counts

```graphql
{ config { traceCap traceCount metricCap metricCount logCap logCount maxDataPoints } }
```

If a `*Count` equals its `*Cap`, the ring buffer is full and older signals
are being evicted — note this when drawing conclusions about what "isn't
there".

## Investigation playbook

### "Something's broken in my app, look at otelop"

1. `config` — confirm otelop has data; note if any buffer is at capacity.
2. `traces(limit: 100)` with `hasError` and `durationMs` — spot the candidate.
3. `trace(traceId) { spans { ... } logs { ... } }` — drill in with the
   correlation join in a single round-trip. Include `events` for
   span-internal markers.
4. If still uncertain, fetch metrics with **values** (`dataPoints { value
   attributes }`) for the relevant service and look for spikes or saturation.
5. Report findings with the trace ID so the user can open the trace at
   `http://localhost:4319/traces/<traceId>`.

### "What's the state of X right now?"

Always fetch the values, not the cardinality:

- "state of metrics" → `dataPoints { value attributes }`, group by series,
  report latest + range per series with units.
- "state of traces" → recent items with `hasError`, `durationMs`,
  `spanCount`, `serviceName`. Note which services are sending.
- "state of logs" → recent items with `severityText`, `body`, and
  `trace { traceId }` to show correlation health.

## Things that bite

- **`Metric.dataPoints[].value` for Histogram / Summary / ExponentialHistogram
  is the cumulative `Count`, not the sum, mean, or any bucket boundary.** The
  GraphQL schema does not expose sum, buckets, quantiles, or min/max for
  these types — this is intentional, not a missing feature. otelop is a local
  "what's flowing through right now" viewer, not a metrics analysis backend.
  If the user wants p99 latency or average request size, say so explicitly
  and point them at Prometheus / Grafana / a real TSDB with PromQL — don't
  invent a number from `value`.
- **`dataPoints` mixes all series for one metric.** A metric with two label
  sets (e.g. `go.memory.used` with `go.memory.type=other` and `=stack`)
  returns 2× the data points in one flat list, distinguished only by
  `attributes`. Group by `attributes` before reporting "the value".
- **Ring buffers evict silently.** If you see fewer items than expected, check
  `config.*Count` vs `*Cap`. Older data is just gone — ask the user to
  reproduce.
- **`*.attributes` and `*.resource` are free-form `JSON`.** Don't assume
  specific keys; filter and print defensively. They can be large — only
  request them when you actually need them.
- **Times are RFC3339 strings** via the `Time` scalar. Parse before diffing.
- **Durations (`Span.durationMs`, `Trace.durationMs`) are milliseconds**, not
  seconds and not nanoseconds.
- **`clearSignals` is destructive.** It empties every ring buffer with no
  undo. Never call it without an explicit, scoped user request.
