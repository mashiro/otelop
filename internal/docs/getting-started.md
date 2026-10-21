---
description: Install and start otelop, send OTLP telemetry to it, and find the browser UI. Use when setting up otelop for the first time or checking its default endpoints.
---
# Getting started

Install the latest release with mise:

```sh
mise use -g github:mashiro/otelop
```

Alternatively, download the archive for your OS and architecture from
[GitHub Releases](https://github.com/mashiro/otelop/releases/latest), extract it,
and place the `otelop` binary in a directory on your `PATH`. Choose `darwin` for
macOS or `linux` for Linux, and `arm64` for Apple Silicon or ARM64 systems, or
`amd64` for Intel/AMD x86-64 systems.

Start otelop as a background process:

```sh
otelop start
```

The default endpoints are:

| Endpoint | Purpose |
| --- | --- |
| `http://localhost:4317` | OTLP gRPC receiver |
| `http://localhost:4318` | OTLP HTTP/protobuf receiver |
| `http://localhost:4319` | Browser UI and GraphQL API |

Configure an application that exports over gRPC:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
OTEL_EXPORTER_OTLP_PROTOCOL=grpc \
your-app
```

Use port `4318` and protocol `http/protobuf` for OTLP over HTTP. Open
<http://localhost:4319> to inspect traces, metrics, and logs.

Useful lifecycle commands:

```sh
otelop status
otelop info
otelop logs -f
otelop restart
otelop stop
```

Run `otelop start --help` for all receiver, storage, proxy, and logging flags.
