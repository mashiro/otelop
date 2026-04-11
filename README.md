<div align="center">

<img src="frontend/public/favicon.svg" width="80" height="80" alt="otelop" />

# otelop

A local OpenTelemetry viewer for traces, metrics, and logs.
Single binary, in-memory, browser UI.

[![Go](https://img.shields.io/badge/go-1.26-00ADD8?logo=go&logoColor=white)](go.mod)
[![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=white)](frontend/package.json)
[![License](https://img.shields.io/badge/license-MIT-black)](LICENSE)

</div>

---

## What it is

`otelop` runs a local OTLP receiver and shows whatever it gets in a browser. No Docker, no database, no Jaeger/Prometheus/Loki to wire up. Start the binary, point your app at it, open the page.

It's meant for the loop where you're writing instrumentation and just want to see what came through.

## Features

- Single binary with the frontend embedded
- OTLP gRPC and HTTP receivers (built-in OpenTelemetry Collector)
- Traces, metrics, and logs in one UI
- Live updates over WebSocket
- GraphQL API at `/graphql`
- MCP server, so agents can query the same data
- In-memory ring buffers — no persistence, no setup

## Install

With Go:

```bash
go install github.com/mashiro/otelop/cmd/otelop@latest
```

With mise:

```bash
mise use -g github:mashiro/otelop
```

## Quick start

```bash
otelop
```

Then point your app at it:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 your-app
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

## Flags

```
otelop [flags]

  --http             Web UI listen address           (default :4319)
  --otlp-grpc        OTLP gRPC receiver endpoint     (default 0.0.0.0:4317)
  --otlp-http        OTLP HTTP receiver endpoint     (default 0.0.0.0:4318)
  --trace-cap        max traces in memory            (default 1000)
  --metric-cap       max metric series in memory     (default 3000)
  --log-cap          max log entries in memory       (default 1000)
  --max-data-points  max data points per series      (default 1000)
  --log-level        debug|info|warn|error           (default warn)
```

## License

MIT
