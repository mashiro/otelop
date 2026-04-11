---
name: otelop-api
description: Investigate OpenTelemetry signals (traces, metrics, logs) buffered by a locally running otelop instance via its GraphQL API. Use this when the user is debugging an app that sends telemetry to otelop and you need to inspect spans, correlate logs with traces, or scan metrics.
---

# Investigating with otelop's GraphQL API

`otelop` buffers every trace, metric, and log it receives in bounded ring
buffers and exposes them at **`http://localhost:4319/graphql`** (the HTTP port
is configurable, but 4319 is the default). When the user is debugging an app
that points its OTLP exporter at otelop, this skill lets you pull exactly the
signals you need without bothering them for screenshots or log dumps.

Before querying, verify otelop is actually running:

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:4319/api/config
```

A non-200 means otelop is not up — ask the user to start it (`mise run dev` or
the `otelop` binary) before retrying.

## Schema overview

The GraphQL schema is introspectable. When in doubt, run:

```graphql
{ __schema { queryType { fields { name description args { name type { name ofType { name } } } } } } }
```

Top-level fields:

- `config` — ring buffer capacities (`traceCap`, `logCap`, …) and current
  counts (`traceCount`, …).
- `traces(limit, offset)` / `trace(traceId)` — list or fetch a single trace.
- `metrics(limit, offset)` — list metrics.
- `logs(limit, offset, traceId)` — list logs, optionally filtered by trace ID.
- Mutation `clearSignals` — drop every buffered signal.

Pagination is simple offset-based. `limit` defaults to 50, `offset` to 0.
Ordering is newest-first for all list fields.

### Types worth knowing

- `Trace.spans: [Span!]!` — every span otelop has buffered under the trace.
- `Trace.hasError: Boolean!` — precomputed; true if any span has
  `statusCode == "Error"`. Use this for the first pass when scanning.
- `Trace.logs: [Log!]!` — **trace↔log correlation join** via one round-trip.
  Prefer `trace(traceId) { logs { ... } }` over a second `logs(traceId: ...)`
  call.
- `Span.durationMs: Float!` / `Trace.durationMs: Float!` — milliseconds.
- `Metric.dataPoints: [DataPoint!]!` / `Metric.pointCount: Int!` — request
  `pointCount` alone when you only want to know "does this metric exist and
  how big is it".
- `Span.attributes: JSON!` / `Log.attributes: JSON!` / `*.resource: JSON!` —
  free-form objects. Only request them when you actually need the values;
  they can be large.

### Graph edges (traversal)

Besides raw ID scalars, every type exposes traversable edges. Use these to
follow relationships in one round-trip instead of issuing multiple queries:

- `Log.trace: Trace` — the correlated trace, or null if the log has no
  traceId or the trace has been evicted.
- `Log.span: Span` — the correlated span, or null if traceId/spanId are
  unset or the trace/span is missing.
- `Span.trace: Trace!` — parent trace (non-null; spans only come via traces).
- `Span.parent: Span` — parent span within the same trace, or null for root
  spans.
- `Trace.rootSpan: Span` / `Trace.spans: [Span!]!` — existing references.

The raw scalars (`Log.traceId`, `Span.parentSpanId`, etc.) are still present
for when you want just the ID without fetching the referenced object.

## How to invoke

There are two equally supported transports. Use whichever matches the
surrounding task.

### 1. Plain HTTP POST (always works)

```bash
curl -s -X POST http://localhost:4319/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query": "{ traces(limit: 20) { items { traceId serviceName hasError durationMs rootSpan { name } } } }"}'
```

### 2. MCP (when the user has registered otelop as an MCP server)

otelop also mounts its MCP server at `http://localhost:4319/mcp` and exposes a
single tool called `query` that takes `{query, variables?, operationName?}`.
This is useful when the caller already has MCP plumbing. otelop is **not**
always running, so assume the MCP server is only reachable while the user has
the process up.

## Query cookbook

**Scan recent traces, errors first**

```graphql
{
  traces(limit: 100) {
    total
    items {
      traceId
      serviceName
      rootSpan { name }
      durationMs
      hasError
      spanCount
    }
  }
}
```

Sort the response yourself: `hasError: true` first, then by `durationMs` desc,
to surface the likely-interesting traces. Drill into one with
`trace(traceId: ...)` below.

**Drill into a trace with its correlated logs**

```graphql
query($id: ID!) {
  trace(traceId: $id) {
    traceId
    serviceName
    durationMs
    hasError
    spans {
      spanId
      name
      kind
      durationMs
      statusCode
      statusMessage
      attributes
    }
    logs {
      timestamp
      severityText
      body
      attributes
    }
  }
}
```

Pass the trace ID as a variable: `{"id": "02000000000000000000000000000000"}`.

**Find logs for a trace without fetching the trace itself**

```graphql
{
  logs(traceId: "02000000000000000000000000000000", limit: 200) {
    total
    items { timestamp severityText body }
  }
}
```

**Traverse from a log back to its trace and span**

```graphql
{
  logs(limit: 50) {
    items {
      body
      severityText
      trace { traceId hasError durationMs }
      span { spanId name durationMs statusCode }
    }
  }
}
```

**List metrics cheaply, then fetch points for one**

```graphql
{
  metrics(limit: 100) {
    items { name type serviceName pointCount }
  }
}
```

Then for a specific metric, refetch with `dataPoints { timestamp value attributes }`.

**Check capacity + current counts**

```graphql
{ config { traceCap traceCount metricCap metricCount logCap logCount maxDataPoints } }
```

If a `*Count` equals its `*Cap`, the ring buffer is full and older signals are
being evicted — note this when drawing conclusions about what "isn't there".

## Investigation playbook

When the user says "something's broken in my app, look at otelop":

1. `config` — confirm otelop has data at all; note if buffers are at capacity.
2. `traces(limit: ...)` with `hasError` and `durationMs` — spot the candidate.
3. `trace(traceId) { spans { ... } logs { ... } }` — drill into the candidate
   with the correlation join in a single round-trip.
4. If you still need metric context, `metrics(limit: ...)` with `pointCount`
   only, then refetch the interesting ones with `dataPoints`.
5. Report findings with the trace ID so the user can open the same trace in
   the otelop UI at `http://localhost:4319/traces/<traceId>`.

## Things that bite

- **Ring buffers evict silently.** If you see fewer items than you expected,
  check `config.*Count` vs `*Cap`. Older data is just gone — ask the user to
  reproduce.
- **`Span.attributes` is free-form.** Don't assume specific keys; filter and
  print defensively.
- **Times are RFC3339 strings** via the `Time` scalar. Parse before diffing.
- **`Float` for durations is milliseconds**, not seconds and not nanoseconds.
- The REST API under `/api/*` also exists for the frontend. Prefer GraphQL
  for investigation — it exposes correlated fields (like `Trace.logs`) that
  the REST API does not.
