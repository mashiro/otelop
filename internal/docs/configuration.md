---
description: Configure otelop receivers, storage, upstream OTLP forwarding, network access, and self-telemetry. Use when changing endpoints, retention, database limits, proxy authentication, or network exposure.
---
# Configuration

Every configuration option can be set in three places. Precedence is:

1. A command-line flag.
2. An `OTELOP_*` environment variable.
3. `$XDG_CONFIG_HOME/otelop/config.toml` (normally `~/.config/otelop/config.toml`).

Config key paths map to CLI flags by replacing dots and underscores with hyphens
(for example, `storage.max_size` becomes `--storage-max-size`). Environment
variables use uppercase underscores and the `OTELOP_` prefix
(`OTELOP_STORAGE_MAX_SIZE`).

The process-control flag `--foreground` is CLI-only. Set `OTELOP_CONFIG_FILE`
to use another config file.

```toml
http = "127.0.0.1:4319"
otlp_grpc = "0.0.0.0:4317"
otlp_http = "0.0.0.0:4318"
log_level = "warn"
debug = false

[storage]
path = ""
retention = "7d"
max_size = "4GB"
memory_limit = "512MB"

[ui]
render_window_max = 500

[proxy]
url = "https://collector.example.com:4318"
protocol = "http"
metrics_temporality = ""

[proxy.batch]
enabled = false

[proxy.auth]
type = "bearer"
token = "replace-me"
```

`otelop info` shows the configuration resolved from CLI flags, `OTELOP_*`
environment variables, the config file, and built-in defaults — the same
precedence as `otelop start`. It does not inspect the running process or
database. To read the live effective storage settings, size, and signal
counts, use the endpoint reported by `otelop status` (or the URL of a hosted
instance) and query:

```graphql
{
  status {
    httpAddr otlpGrpcAddr otlpHttpAddr proxyUrl proxyProtocol
    config { storagePath retention maxSize traceCount metricCount logCount }
    storage {
      fileSizeBytes maxSizeBytes walSizeBytes memoryUsageBytes memoryLimitBytes tempStorageBytes
      databaseSizeBytes totalBlocks usedBlocks freeBlocks
      tables { name rows }
      oldestTimestamp newestTimestamp
      retentionMs sweepIntervalMs nextSweepAt
      lastSweep { startedAt durationMs deletedRows maxSizeIterations error }
    }
  }
}
```

The header's **Server info** button shows these details in a read-only dialog,
refreshed once a minute while open. Reopening within a minute reuses the cached
result to avoid repeating full-data statistics queries.

`storage` sizes are bytes and durations are milliseconds. `tables` reports row
counts for resources, metric series, spans, metric points, and logs; these differ
from the logical signal counts in `config`. The oldest/newest timestamps are
`null` when no signal data is retained. `lastSweep` is `null` until a sweep has
completed in the current process. Its `deletedRows` counts deleted spans, metric
points, and logs; `error` is empty on success. `nextSweepAt` is the expected
scheduled time, not a completion deadline.

`databaseSizeBytes` and block counts describe DuckDB allocation; free blocks can
be reused without shrinking the file. `max_size` is compared with the used
blocks, not the file size, so the file can stay larger than `max_size` after
old data is deleted. `fileSizeBytes` excludes the separately
reported WAL. The existing `status.dbSizeBytes` also reports the database file size.

`memory_limit` caps DuckDB's buffer pool and query memory (`memoryLimitBytes`
in `storage`); queries that need more spill to a temp directory next to the
database file instead of growing resident memory further. Some operations
cannot spill, so setting it much lower than the default can make queries fail
with DuckDB `Out of Memory` errors.

The Web UI and GraphQL endpoint have no authentication and bind to
`127.0.0.1` by default. A loopback listener rejects non-local `Host` headers
to guard against DNS rebinding. Binding `--http` to `0.0.0.0:4319` or another
non-loopback address exposes the endpoint and accepts any `Host`; control
access with the surrounding reverse proxy, load balancer, or network policy.

Proxy authentication supports `bearer`, `basic`, and `headers`. Configure exact
headers as a TOML table:

```toml
[proxy.auth]
type = "headers"

[proxy.auth.headers]
Authorization = "Bearer replace-me"
X-Api-Key = "replace-me"
```

The CLI equivalent is a repeatable `--proxy-auth-headers key=value`; use
`OTELOP_PROXY_AUTH_HEADERS` for the environment source. Do not put credentials in
`proxy.url`. Treat configuration files and environment values containing
credentials as secrets and do not print them in agent responses.

`proxy.metrics_temporality = "delta"` converts cumulative sums and histograms
to delta before forwarding, for upstreams that accept only delta metrics. The
conversion applies to the upstream copy only; otelop still stores metrics with
the temporality the application sent. The first point of a counter that
started before otelop is dropped upstream, because its cumulative total cannot
be split into a delta. Leave it empty to forward metrics unchanged.

By default each export otelop receives is forwarded upstream as-is.
`proxy.batch.enabled = true` batches forwarded data first. Every other
`[proxy.batch]` key is optional; when a key is omitted, the OpenTelemetry
Collector's exporter batching default applies:

```toml
[proxy.batch]
enabled = true
flush_timeout = "200ms"  # send a partial batch after this long
sizer = "bytes"          # unit for min_size/max_size: requests, items, or bytes
min_size = 1048576       # send once a batch reaches this size
max_size = 3145728       # split batches larger than this
```

The Collector validates these values when otelop starts.

`proxy.url` may omit the port; otelop then uses 443 for `https` and 80 for
`http`.

With `debug = true`, otelop exports its own telemetry back to itself. Leave it
off unless self-observation is intentional.
