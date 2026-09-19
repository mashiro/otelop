---
description: Configure otelop receivers, storage, upstream OTLP forwarding, network access, and self-telemetry. Use when changing endpoints, retention, database limits, proxy authentication, or network exposure.
---
# Configuration

Every configuration option can be set in three places. Precedence is:

1. A command-line flag.
2. An `OTELOP_*` environment variable.
3. `$XDG_CONFIG_HOME/otelop/config.toml` (normally `~/.config/otelop/config.toml`).

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

[ui]
render_window_max = 500

[proxy]
url = "https://collector.example.com:4318"
protocol = "http"

[proxy.auth]
type = "bearer"
token = "replace-me"
```

`otelop info` displays values from the TOML file with built-in defaults. It
does not apply environment or CLI overrides and does not inspect the running
process or database. To read the live effective storage settings, size, and
signal counts, use the endpoint reported by `otelop status` and query:

```graphql
{
  status {
    httpAddr otlpGrpcAddr otlpHttpAddr proxyUrl proxyProtocol dbSizeBytes
    config { storagePath retention maxSize traceCount metricCount logCount }
  }
}
```

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

The CLI equivalent is a repeatable `--proxy-header key=value`; use
`OTELOP_PROXY_HEADERS` for the environment source. Do not put credentials in
`proxy.url`. Treat configuration files and environment values containing
credentials as secrets and do not print them in agent responses.

With `debug = true`, otelop exports its own telemetry back to itself. Leave it
off unless self-observation is intentional.
