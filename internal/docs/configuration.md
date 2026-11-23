---
description: Configure otelop receivers, storage, upstream OTLP exporters, network access, and self-telemetry. Use when changing endpoints, retention, database limits, forwarding to other OTLP backends, or network exposure.
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

The process-control flag `--foreground` is CLI-only, and `[exporters.<name>]`
tables are config-file-only. Set `OTELOP_CONFIG_FILE` to use another config
file.

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

[exporters.upstream]
url = "https://collector.example.com:4318"
protocol = "http"

[exporters.upstream.auth]
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
    httpAddr otlpGrpcAddr otlpHttpAddr
    exporters { name url protocol }
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

## Exporters

Each `[exporters.<name>]` table forwards a copy of every trace, metric, and log
otelop receives to another OTLP endpoint. otelop still stores everything
locally for the UI. Define as many tables as you need; each one is
independent. Names may contain letters, digits, `_`, and `-`.

```toml
[exporters.team]
url = "https://collector.example.com:4318"
protocol = "http"           # http or grpc

[exporters.archive]
url = "https://archive.example.com:4317"
protocol = "grpc"
```

`url` and `protocol` are required. `url` may omit the port; otelop then uses
443 for `https` and 80 for `http`. For `grpc`, `url` may also be a bare
`host:port`, which connects with TLS like `https://host:port`; use
`http://host:port` to connect without TLS. Do not put credentials in `url`; otelop
rejects URLs with userinfo such as `https://user:pass@example.com`.

Authentication supports `bearer`, `basic`, and `headers`. Configure exact
headers as a TOML table:

```toml
[exporters.team.auth]
type = "headers"

[exporters.team.auth.headers]
Authorization = "Bearer replace-me"
X-Api-Key = "replace-me"
```

`bearer` takes `token`, and `basic` takes `username` and `password`.

To keep a secret out of the config file, reference an environment variable in
`auth.token` or an `auth.headers` value:

```toml
[exporters.team.auth.headers]
X-Api-Key = "${env:TEAM_API_KEY}"
```

otelop passes these values to the OpenTelemetry Collector unchanged, and the
Collector resolves them from the environment of the `otelop start` process. See
[Collector configuration: environment variables](https://opentelemetry.io/docs/collector/configuration/#environment-variables)
for the syntax. `otelop info` and `otelop status` show neither the reference
nor its value. Automatic startup at login may not see variables set in an
interactive shell. `url`, `auth.username`, and `auth.password` cannot reference
environment variables.

Treat a config file containing credentials as a secret and do not print it in
agent responses.

`metrics_temporality = "delta"` converts cumulative metrics to delta before
sending them to that exporter, for upstreams that accept only delta metrics.
Other exporters and local storage keep the temporality the application sent.
otelop uses the
[cumulativetodelta processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/cumulativetodeltaprocessor/README.md)
with its default settings. Leave it empty to forward metrics unchanged.

By default each export otelop receives is forwarded as-is. `batch.enabled =
true` batches data for that exporter first. The other `batch` keys are optional
and are passed to the exporter's
[batch settings](https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/exporterhelper/README.md)
only when set:

```toml
[exporters.team.batch]
enabled = true
flush_timeout = "200ms"
sizer = "bytes"
min_size = 1048576
max_size = 3145728
```

`otelop info` lists the configured exporters, and `otelop status` and the
**Server info** dialog list the ones the running instance uses.

With `debug = true`, otelop exports its own telemetry back to itself. Leave it
off unless self-observation is intentional.
