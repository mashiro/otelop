# DuckDB-backed storage

Status: accepted
Date: 2026-07-11

## Summary

Replace the in-memory ring-buffer store with an embedded DuckDB database as the
single source of truth for all telemetry. Retention becomes time-based
(default 7 days) with a disk-size ceiling, ingest becomes stateless, and
metric delta/cumulative values are derived at query time with window
functions instead of being computed (and made irrecoverable) at ingest.

## Motivation

- Telemetry currently dies with the process. Restarting otelop mid-debugging
  loses the traces you were looking at.
- Ring-buffer capacities (`trace_cap` etc.) are a poor proxy for "how far back
  can I look?". A time-based window matches how the tool is used.
- The frontend has a time-range selector for metric charts; a columnar store
  makes time-range queries over history the natural primitive instead of an
  in-memory slice.

otelop remains a local, single-process dev tool. Durable long-term storage is
explicitly out of scope — that is what LGTM-stack deployments are for.

## Architecture

```
OTLP receiver → exporter → convert (pure functions) → writer goroutine (single)
                                                        ├─ Appender: spans / metric_points / metric_exemplars / logs
                                                        ├─ update: trace_summaries
                                                        ├─ upsert: resources / metric_series
                                                        └─ commit per OTLP batch → WebSocket broadcast
GraphQL resolvers ──────────────────────────────────────→ read-only SQL (separate connection)
```

Key decisions:

1. **DuckDB is the primary store.** There is no in-memory buffer layer. Every
   read is SQL; the "latest N" view is a tail query. In-memory state is
   limited to pure caches such as known dimension hashes. A cache miss only
   repeats an idempotent write, so eviction can never corrupt results. Span
   identity is checked directly against DuckDB rather than cached.
2. **Ingest is stateless.** Metric points are stored with their *raw* OTLP
   values plus temporality/monotonicity metadata. Delta-ization of cumulative
   inputs and accumulation of delta inputs both move to query time
   (`lag()` / `sum() OVER`). This makes cumulative values durable across
   restarts, makes conversion bugs recoverable (fix the query, not the data),
   and deletes the old `seriesStore` TTL/cardinality machinery outright.
3. **Every list query takes a time range.** With a 7-day window the dataset
   can reach tens of millions of rows; `WHERE ts >= ? AND ts < ?` plus
   DuckDB zonemaps (data arrives roughly time-ordered) keeps queries pruned.
   The frontend defaults to a recent window; live updates continue to arrive
   over WebSocket.
4. **Trace summaries are derived and persisted.** Spans remain the source of
   truth, but the hot list path reads one narrow `trace_summaries` row per
   trace instead of regrouping every retained span on every request. Ingest
   updates only summaries for traces that received a new `(trace_id, span_id)`;
   retention rebuilds only summaries whose spans were deleted.

## Schema

Three dimension tables keep the fact tables narrow. Resources repeat for every
span/log; series metadata repeats for every point; histogram layouts normally
repeat for every export. All are hash-keyed so they can be computed statelessly
at ingest.

```sql
-- dimensions (small, low write rate)
CREATE TABLE resources (
  resource_hash UBIGINT PRIMARY KEY,   -- hash over schema URL + sorted attributes
  service_name  VARCHAR NOT NULL,
  schema_url    VARCHAR NOT NULL,
  dropped_attributes_count UINTEGER NOT NULL,
  attributes    JSON NOT NULL,
  attributes_raw BLOB NOT NULL       -- versioned, lossless OTLP type encoding
);

CREATE TABLE metric_series (
  series_key    UBIGINT PRIMARY KEY,   -- hash(resource, scope, full descriptor, sorted attrs)
  service_name  VARCHAR NOT NULL,
  metric_name   VARCHAR NOT NULL,
  metric_type   VARCHAR NOT NULL,      -- Gauge | Sum | Histogram | ExponentialHistogram | Summary
  number_kind   VARCHAR NOT NULL,      -- int | double | empty for distributions
  unit          VARCHAR,
  description   VARCHAR,
  temporality   VARCHAR,               -- cumulative | delta
  is_monotonic  BOOLEAN,
  attributes    JSON NOT NULL,
  attributes_raw BLOB NOT NULL,
  scope_name       VARCHAR NOT NULL,
  scope_version    VARCHAR NOT NULL,
  scope_schema_url VARCHAR NOT NULL,
  scope_dropped_attributes_count UINTEGER NOT NULL,
  scope_attributes JSON NOT NULL,
  scope_attributes_raw BLOB NOT NULL,
  resource_hash UBIGINT NOT NULL,      -- references resources, like spans/logs
  first_seen    TIMESTAMP_NS NOT NULL,
  last_seen     TIMESTAMP_NS NOT NULL
);

CREATE TABLE histogram_layouts (
  layout_hash     UBIGINT PRIMARY KEY,
  kind            VARCHAR NOT NULL,   -- explicit | exponential
  explicit_bounds DOUBLE[],
  scale           INTEGER,
  zero_threshold  DOUBLE
);

-- facts (large, append-only)
CREATE TABLE spans (
  trace_id       VARCHAR NOT NULL,
  span_id        VARCHAR NOT NULL,
  parent_span_id VARCHAR,
  name           VARCHAR NOT NULL,
  kind           VARCHAR,
  start_ts       TIMESTAMP_NS NOT NULL,
  end_ts         TIMESTAMP_NS NOT NULL,
  status_code    VARCHAR,
  status_message VARCHAR,
  attributes     JSON,
  events         JSON,
  resource_hash  UBIGINT NOT NULL,
  ingested_at    TIMESTAMP_NS NOT NULL
);
CREATE INDEX idx_spans_trace ON spans (trace_id);

-- derived from spans; rebuildable without information loss
CREATE TABLE trace_summaries (
  trace_id               VARCHAR PRIMARY KEY,
  start_ts               TIMESTAMP_NS NOT NULL,
  end_ts                 TIMESTAMP_NS NOT NULL,
  span_count             BIGINT NOT NULL,
  has_error              BOOLEAN NOT NULL,
  first_seen             TIMESTAMP_NS NOT NULL,
  root_span_id           VARCHAR,
  root_name              VARCHAR,
  root_kind              VARCHAR,
  root_status_code       VARCHAR,
  root_start_ts          TIMESTAMP_NS,
  root_end_ts            TIMESTAMP_NS,
  root_resource_hash     UBIGINT,
  earliest_span_id       VARCHAR NOT NULL,
  earliest_resource_hash UBIGINT NOT NULL
);

CREATE TABLE dropped_traces (
  trace_id   VARCHAR PRIMARY KEY,
  last_seen  TIMESTAMP_NS NOT NULL,
  span_count BIGINT NOT NULL
);

CREATE TABLE metric_points (
  id           UUID NOT NULL,          -- UUIDv7 minted at ingest (stable client key)
  series_key   UBIGINT NOT NULL,
  ts           TIMESTAMP_NS NOT NULL,
  start_ts     TIMESTAMP_NS,           -- OTLP StartTimestamp, used for reset detection
  ingested_at  TIMESTAMP_NS NOT NULL,
  flags        UINTEGER NOT NULL,      -- raw OTLP DataPointFlags
  value_int    BIGINT,                 -- exact NumberDataPoint integer arm
  value_double DOUBLE,                 -- exact NumberDataPoint double arm
  count        UBIGINT,
  sum          DOUBLE,
  min          DOUBLE,
  max          DOUBLE,
  histogram_layout_hash UBIGINT,
  bucket_counts UBIGINT[],            -- explicit histogram buckets
  zero_count UBIGINT,                 -- exponential histogram zero bucket
  positive_offset INTEGER,
  positive_bucket_counts UBIGINT[],
  negative_offset INTEGER,
  negative_bucket_counts UBIGINT[],
  summary_quantiles DOUBLE[],
  summary_quantile_values DOUBLE[]
);

CREATE TABLE metric_exemplars (
  id                  UUID NOT NULL,
  point_id            UUID NOT NULL,
  ts                  TIMESTAMP_NS NOT NULL,
  trace_id            VARCHAR,
  span_id             VARCHAR,
  filtered_attributes JSON NOT NULL,
  filtered_attributes_raw BLOB NOT NULL,
  value_int           BIGINT,
  value_double        DOUBLE
);
CREATE INDEX idx_metric_exemplars_point ON metric_exemplars (point_id);

CREATE TABLE logs (
  id              UUID NOT NULL,       -- UUIDv7 minted at ingest
  ts              TIMESTAMP_NS NOT NULL,
  observed_ts     TIMESTAMP_NS,
  trace_id        VARCHAR,
  span_id         VARCHAR,
  severity_number INTEGER,
  severity_text   VARCHAR,
  body            VARCHAR,
  attributes      JSON,
  resource_hash   UBIGINT NOT NULL,
  ingested_at     TIMESTAMP_NS NOT NULL
);
CREATE INDEX idx_logs_trace ON logs (trace_id);

CREATE TABLE schema_meta (version INTEGER NOT NULL);
```

Notes:

- `TIMESTAMP_NS` everywhere — OTel emits nanosecond precision and the frontend
  relies on it (`Temporal.Instant`). DuckDB's default `TIMESTAMP` is µs.
- The explicit ART indexes are limited to `trace_id` on spans and logs.
  `trace_summaries.trace_id` and dimension hashes use narrow primary-key ART
  indexes for conflict lookup; time-range scans rely on zonemap pruning.
- Attribute maps stay `JSON`: variable keys need no schema and remain
  queryable (`attributes->>'http.method'`).
- Each metric-related attribute map also keeps a versioned canonical BLOB.
  JSON alone cannot distinguish int64 from double or bytes from string, so
  the BLOB is the lossless source while JSON remains the query projection.
- Histogram layouts are hash-deduplicated because explicit boundaries and
  exponential scale normally remain stable for an instrument. Point rows keep
  only the changing bucket counts. Window percentiles first delta-derive each
  cumulative series, then merge buckets across series; per-point percentiles
  are never averaged.
- Scalar integer values and distribution counts remain integers in raw
  storage. Query-time chart/statistic projections may cast them to DOUBLE,
  but the received OTLP value remains recoverable without the 2^53 precision
  limit.
- Metric identity includes type, numeric kind, unit, temporality, and
  monotonicity. Description is deliberately excluded because it is metadata,
  not stream identity.
- Flags, Summary quantiles, exemplars, and ingestion time are retained even
  when the current GraphQL/UI does not expose them yet. This keeps later
  interpretation fixes recoverable from DuckDB. Duplicate intervals are
  identifiable from `(series_key, start_ts, ts)` without storing a random,
  compression-resistant hash on every point.

## Ingest

A single writer goroutine owns the write connection. Per OTLP batch:

1. Convert pdata to row values (pure functions; no shared state).
2. Insert unseen `resources`, then bulk-stage and merge `histogram_layouts`
   and `metric_series` metadata (including `last_seen`). This keeps one export
   with thousands of series to a constant number of SQL statements instead
   of preparing and executing one upsert per series. An LRU of known resource
   hashes skips redundant writes; the LRU is only a cache.
3. For traces already present in `trace_summaries`, query only the incoming
   candidate span IDs through `idx_spans_trace`; new traces need no fact-table
   lookup. Rows not already present append to spans and update only their trace
   summaries. The lookup, append, summary upsert, oversize-trace tombstone, and
   deletion share one transaction. This keeps duplicate handling independent
   of arrival order and process-local caches.
4. Append metric points and exemplars through DuckDB Appenders in the same
   transaction; append log facts through their Appender and flush.
5. After commit, invoke `onAdd` (outside any lock) to feed the WebSocket hub,
   mirroring the previous store's contract. Trace broadcasts reuse the
   summaries produced by the write transaction.

WebSocket payloads still carry per-point deltas for live charts. After a
metric batch commits, the broadcast adapter queries the committed points plus
the immediately preceding observation for each represented series and applies
the same SQL derivation used by GraphQL. Duplicate spans from OTLP re-sends are
filtered by the indexed candidate lookup, so a restart or a resend cannot
inflate stored spans or summaries.

A trace that crosses 10,000 retained spans is not useful as an interactive
trace and can otherwise grow without bound. The write transaction deletes its
spans and summary, records a `dropped_traces` tombstone, and publishes a
`trace-deletes` WebSocket event so clients remove any stale live summary.
Further spans for that trace refresh the tombstone and are discarded without
touching the spans table. Retention removes a tombstone after its producer has
stopped sending the trace for a full retention period. Existing oversized
traces are intentionally handled only when new data for them arrives; an
unreferenced historical trace does not add idle processing cost.

Backpressure: the channel into the writer is bounded; when full, batches are
dropped with a `slog.Warn`, the same policy the WebSocket hub applies. Crash
safety comes from DuckDB's WAL (per-batch flush + periodic checkpoints).

## Reads

Trace list reads the incrementally maintained rows directly. Search still uses
an `EXISTS` over spans because non-root span names and services are searchable:

```sql
SELECT
  trace_id, start_ts, end_ts - start_ts AS duration,
  span_count, has_error, first_seen, root_name
FROM trace_summaries
WHERE start_ts >= $from AND start_ts < $to
ORDER BY start_ts DESC, first_seen DESC, trace_id DESC
LIMIT $limit;
```

Metric chart — delta/cumulative derived per series:

```sql
SELECT p.ts, p.id,
  CASE WHEN s.temporality = 'cumulative' AND s.is_monotonic
       THEN CASE WHEN value < lag(value) OVER w THEN value  -- counter reset
                 ELSE value - lag(value) OVER w END
       ELSE value END                                  AS value,
  CASE WHEN s.temporality = 'delta' AND s.is_monotonic
       THEN sum(value) OVER w
       ELSE value END                                  AS cumulative
FROM (
  SELECT *, coalesce(value_double, cast(value_int AS DOUBLE)) AS value
  FROM metric_points
) p
JOIN metric_series s USING (series_key)
WHERE p.series_key = $key AND p.ts >= $from AND p.ts < $to
WINDOW w AS (PARTITION BY p.series_key ORDER BY p.ts);
```

Histogram/Summary `count`/`sum` columns get the same window treatment. The
first observation of a cumulative series yields `NULL` delta (`lag` has no
predecessor) — the UI skips it, matching the old "baseline dropped" behavior
while keeping the raw row.

## Retention and disk management

- `retention` (default `"7d"`): an hourly sweep runs
  `DELETE ... WHERE ts < now() - retention` followed by `CHECKPOINT`. Because
  rows arrive roughly time-ordered, old row groups delete wholesale and their
  space is reused in-file. Trace summaries touched by deleted spans are rebuilt
  in the same transaction; unaffected traces are not scanned.
- `max_size` (default `"4GB"`): if the database file exceeds the ceiling, the
  sweep trims the oldest day repeatedly until under it. Users are protected by
  whichever bound is tighter.
- Dimension rows no longer referenced by any fact row are pruned during the
  sweep.
- `clearSignals` deletes from all tables and checkpoints. The database lives at
  `$XDG_DATA_HOME/otelop/otelop.duckdb` (falling back to
  `~/.local/share/otelop/`); deleting the file remains a valid reset.
- GraphQL `status` and CLI `otelop info` report file size and per-table row
  counts.

Sizing: DuckDB compresses spans to roughly 100–300 B/row. A very busy week
(~10 M spans) lands around 1–3 GB, comfortably inside the default ceiling.

## Configuration changes (breaking)

`trace_cap`, `metric_cap`, `log_cap`, and `max_data_points` are removed.

```toml
[storage]
path      = ""      # empty → XDG default
retention = "7d"
max_size  = "4GB"
```

CLI: `--storage-path`, `--retention`, `--max-size`, with the usual
flag > env > TOML > default precedence.

## Build and release impact

The Go driver is `github.com/duckdb/duckdb-go` (v2.5+, maintained by the
DuckDB team; `marcboeker/go-duckdb` is archived). It requires CGO with
prebuilt per-target static libraries.

- Releases move from a single `CGO_ENABLED=0` cross-compiling runner to a
  native build matrix in `.github/workflows/release.yml`: `ubuntu-latest`
  builds linux/amd64, `ubuntu-24.04-arm` (a free-tier hosted Arm runner)
  builds linux/arm64, and `macos-latest` builds both darwin/arm64 (native)
  and darwin/amd64 (Xcode's clang cross-compiles x86_64 from an arm64 host
  within the same OS/SDK via `CGO_CFLAGS`/`CGO_LDFLAGS="-arch x86_64"` —
  verified locally). No target is built under qemu or a cross-gcc.
- Cross-compiling darwin from linux (zig cc / osxcross) was evaluated and
  rejected: Apple does not redistribute the macOS SDK, and linking DuckDB's
  Apple-clang-built C++ static archives through zig's Mach-O linker is an
  unsupported combination that would break silently on dependency bumps.
- goreleaser can't assemble a release from externally-built, per-OS
  binaries on the free tier (that needs its Pro-only "prebuilt" builder or
  split/merge), and it always builds something itself even with an empty
  `builds:` list — so it no longer drives the actual release. A final job
  downloads the matrix's binaries, assembles archives/checksums with
  `scripts/package-release.sh`, attaches them to the GitHub Release
  release-please already created (`gh release upload`), and builds/pushes
  the multi-platform Docker image with `docker buildx` directly from the
  two prebuilt linux binaries (again no qemu). `.goreleaser.yml` is kept
  only for local use (`mise run release-snapshot`, via
  `goreleaser build --single-target` since a single host only has a native
  toolchain for its own goos/goarch) and for `goreleaser check` in CI.
- The Dockerfile's base image moved from `distroless/static` to
  `debian:bookworm-slim` with `libstdc++6` installed explicitly: a CGO
  binary linking DuckDB links glibc and libstdc++ dynamically (confirmed via
  `otool -L` on the darwin build), and neither distroless/static nor
  distroless/cc ships a C++ runtime.
- Binary size grows by tens of MB (embedded DuckDB). Accepted for a local
  tool.

## Rollout phases

1. `internal/storage`: schema + migrations, writer goroutine, Appender
   batching, retention/max_size sweep. Tested against temp-file databases.
2. Read query layer: trace aggregation, window-function derivation, dedup.
   The old `Merge`/`seriesStore` table tests are ported as query tests.
3. Wire GraphQL/WebSocket/MCP to storage; config/CLI changes; delta broadcast.
4. Frontend: default recent time window, config surface.
5. CI matrix + goreleaser rework; delete `internal/store`.

## Out of scope (deliberately)

- Multi-process access to the database file (DuckDB is single-writer;
  otelop's daemon model already guarantees one process).
- Full-text search over log bodies (`ILIKE` is sufficient at this scale; the
  FTS extension can be revisited later).
- Persisting raw OTLP protobuf payloads.
