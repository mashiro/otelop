<div align="center">

<img src="frontend/public/favicon.svg" width="80" height="80" alt="otelop" />

# otelop

A local OpenTelemetry viewer for traces, metrics, and logs.
Single binary, persistent local storage, browser UI.

[![Go](https://img.shields.io/badge/go-1.26-00ADD8?logo=go&logoColor=white)](go.mod)
[![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=white)](frontend/package.json)
[![License](https://img.shields.io/badge/license-MIT-black)](LICENSE)

</div>

---

## What it is

`otelop` runs a local OTLP receiver and shows whatever it gets in a browser. No Docker, external database, or Jaeger/Prometheus/Loki stack to wire up. Start the binary, point your app at it, open the page.

It's meant for the loop where you're writing instrumentation and just want to see what came through.

<div align="center">

![otelop trace view](docs/images/trace.png)

</div>

## Features

- Single binary with the frontend embedded
- OTLP gRPC and HTTP receivers (built-in OpenTelemetry Collector)
- Optional OTLP forwarding to one upstream endpoint
- Traces, metrics, and logs in one UI
- Server-side search, time-window navigation, and infinite scrolling for traces and logs
- Log context navigation for inspecting records around a selected event
- Embedded DuckDB storage with time-based retention
- Live updates over WebSocket
- GraphQL API at `/graphql`
- Persistent history across restarts with no external setup
- Optional self-observability for otelop's own traces, metrics, and logs

## Install

With Go:

```bash
go install github.com/mashiro/otelop/cmd/otelop@latest
```

With mise:

```bash
mise use -g github:mashiro/otelop
```

With Docker:

```bash
docker run --rm \
  -p 4317:4317 -p 4318:4318 -p 4319:4319 \
  -v otelop-data:/data \
  ghcr.io/mashiro/otelop:latest
```

The named volume keeps the DuckDB database when the container is replaced or
removed. Delete the `otelop-data` volume explicitly when you want to discard
the stored telemetry.

## Quick start

```bash
otelop start
```

This detaches into the background so your terminal stays free. Use `otelop status` to see what it is listening on and `otelop stop` to shut it down. Pass `--foreground` (or `-f`) if you want logs in the current terminal.

Then point your app at it:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
OTEL_EXPORTER_OTLP_PROTOCOL=grpc \
your-app
```

For OTLP over HTTP/protobuf, use port `4318` instead:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
your-app
```

And open <http://localhost:4319>.

### With AI coding agents

Any AI coding agent that supports OpenTelemetry can export to `otelop`, so you can watch the agent's API calls, tool runs, and prompts live. For example:

- [Claude Code](https://docs.claude.com/en/docs/claude-code/monitoring-usage)
- [Codex](https://developers.openai.com/codex/config-advanced)

## Endpoints

| Port | Purpose |
|---|---|
| `4319` | Web UI + GraphQL |
| `4317` | OTLP gRPC receiver |
| `4318` | OTLP HTTP receiver |

The GraphQL endpoint is available at `http://localhost:4319/graphql`.

The Web UI/GraphQL endpoint has no authentication, so it binds to
`127.0.0.1` by default — set `--http 0.0.0.0:4319` (or an env/config
equivalent) to opt in to exposing it on the LAN. The published Docker image
binds `0.0.0.0:4319` inside the container by default, since Docker's own
`-p` publishing is itself an explicit opt-in.

To guard against DNS rebinding, `/graphql` and `/ws` also reject requests
whose `Host` header isn't an IP literal or `localhost`. If you run `otelop`
under a hostname (e.g. reverse-proxied at `http://otelop.internal:4319`),
add it to `allowed_hosts` (or `--allowed-hosts`/`OTELOP_ALLOWED_HOSTS`) —
see [Configuration](#configuration).

## Commands

```
otelop start [flags]   # launch in the background (default), or foreground with -f
otelop restart [flags] # restart with the current flags, environment, and config
otelop stop            # stop the background server
otelop status          # show whether it's running: PID, version, uptime, listen addresses
otelop info            # show config-file values, built-in defaults, and resolved paths
otelop logs [-f]       # print the daemon log, or follow it with -f
otelop version
otelop docs list       # list documentation bundled with this binary (--json for JSON)
otelop docs show <name> # print one document as Markdown
```

The bundled documentation always matches the installed otelop version. This is
also the preferred entry point for coding agents: run `otelop docs list --json`,
then `otelop docs show <name>` for the relevant topic.

`start` flags:

```
  --foreground, -f   run in the foreground instead of detaching
  --http             Web UI listen address           (default 127.0.0.1:4319)
  --otlp-grpc        OTLP gRPC receiver endpoint     (default 0.0.0.0:4317)
  --otlp-http        OTLP HTTP receiver endpoint     (default 0.0.0.0:4318)
  --allowed-hosts    comma-separated hostnames to allow beyond loopback/IP literals (e.g. otelop.internal,*.example.com)
  --proxy-url        upstream OTLP endpoint for forwarding
  --proxy-protocol   upstream OTLP protocol          (grpc|http)
  --proxy-auth-type  upstream OTLP auth type         (bearer|basic|headers)
  --proxy-auth-token upstream bearer token
  --proxy-auth-username upstream basic auth username
  --proxy-auth-password upstream basic auth password
  --proxy-header     upstream header                 (repeatable key=value)
  --storage-path     DuckDB database path             (default: XDG data directory)
  --retention        telemetry retention period       (default 7d)
  --max-size         database size ceiling            (default 4GB)
  --render-window-max max rows the traces/metrics/logs tables render at once (default 500)
  --log-level        debug|info|warn|error           (default warn)
  --debug            export otelop's own telemetry to itself
```

PID, log, and metadata files live in `$XDG_STATE_HOME/otelop/` (defaults to
`~/.local/state/otelop/`). The DuckDB database defaults to
`$XDG_DATA_HOME/otelop/otelop.duckdb` (or
`~/.local/share/otelop/otelop.duckdb`). Use `otelop info` to see config-file
values and resolved paths. Query GraphQL `status` for the running instance's
effective storage settings, file size, and logical signal counts.

## Configuration

Every configuration flag can be set three ways; `--foreground` is CLI-only.
Higher precedence wins:

1. CLI flag (`otelop start --http 127.0.0.1:4319`)
2. Environment variable (`OTELOP_HTTP=127.0.0.1:4319 otelop start`)
3. TOML config file at `$XDG_CONFIG_HOME/otelop/config.toml` (defaults to `~/.config/otelop/config.toml`; override with `OTELOP_CONFIG_FILE=/path/to/config.toml`)

Example `~/.config/otelop/config.toml`:

```toml
http = "127.0.0.1:4319"
otlp_grpc = "0.0.0.0:4317"
otlp_http = "0.0.0.0:4318"
allowed_hosts = [] # e.g. ["otelop.internal", "*.example.com"]
log_level = "warn"
debug = false

[storage]
path = "" # empty uses $XDG_DATA_HOME/otelop/otelop.duckdb
retention = "7d"
max_size = "4GB"

[ui]
render_window_max = 500 # max rows the traces/metrics/logs tables render at once

[proxy]
url = "https://collector.internal:4318"
protocol = "http"

[proxy.auth]
type = "bearer"
token = "replace-me"
```

The matching environment variables are `OTELOP_HTTP`, `OTELOP_OTLP_GRPC`, `OTELOP_OTLP_HTTP`, `OTELOP_PROXY_URL`, `OTELOP_PROXY_PROTOCOL`, `OTELOP_PROXY_AUTH_TYPE`, `OTELOP_PROXY_AUTH_TOKEN`, `OTELOP_PROXY_AUTH_USERNAME`, `OTELOP_PROXY_AUTH_PASSWORD`, `OTELOP_PROXY_HEADERS`, `OTELOP_STORAGE_PATH`, `OTELOP_RETENTION`, `OTELOP_MAX_SIZE`, `OTELOP_RENDER_WINDOW_MAX`, `OTELOP_LOG_LEVEL`, `OTELOP_DEBUG`, and `OTELOP_ALLOWED_HOSTS` (comma-separated).

When proxying is enabled, `otelop` still stores incoming telemetry locally for the UI and also forwards the same traces, metrics, and logs to the configured upstream OTLP endpoint.

When `debug = true` or `--debug` is set, otelop exports its own telemetry back
to its local receiver. This includes request and storage traces, process and
collector metrics, DuckDB query/storage metrics, and application logs. Leave it
disabled for normal use if you do not want otelop's own activity mixed into the
data you are inspecting.

`proxy.auth.type` supports:

- `bearer`: sends `Authorization: Bearer <token>`
- `basic`: sends `Authorization: Basic <base64(username:password)>`
- `headers`: sends the exact headers configured under `[proxy.auth.headers]` or `--proxy-header`

Do not embed credentials in `proxy.url`; `otelop` rejects URLs with userinfo such as `https://user:pass@example.com`.

## Development

The main development tasks are managed by mise:

```bash
mise run install # install Go and frontend dependencies
mise run dev     # start backend and frontend development servers
mise run check   # format, lint, and type-check
mise run test    # run Go and frontend tests
mise run build   # build the embedded frontend and Go binary
```

Component tasks can also be run directly, such as `mise run dev:backend`,
`mise run test:frontend`, or `mise run build:frontend`.

## License

MIT
