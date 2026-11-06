---
description: Install and start otelop, send OTLP telemetry to it, and find the browser UI. Use when setting up otelop for the first time or checking its default endpoints.
---
# Getting started

Install the latest release with mise:

```sh
mise use -g github:mashiro/otelop
```

Alternatively, prebuilt binaries for macOS and Linux are available from
[GitHub Releases](https://github.com/mashiro/otelop/releases/latest).

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

## Start automatically at login

On macOS or Linux with systemd, register otelop for your user account:

```sh
otelop startup enable
otelop startup status
```

Automatic startup takes effect at the next login and requires no administrator
privileges. Use `otelop start` to start the server now. On Linux, all existing
user sessions must end first; a user manager kept running by lingering must
also exit before automatic startup takes effect.

Configure runtime settings in the TOML configuration file available to your
login session. Use absolute paths for custom storage locations. Settings from
an interactive shell or a project directory may not be available at login.

Automatic startup runs `otelop start` once per login session; it does not restart
the server if it exits. Use `otelop status`, `otelop logs`, `otelop restart`, and
`otelop stop` to manage the server.

Remove automatic startup with:

```sh
otelop startup disable
```

This affects future user sessions and leaves a currently running server alone.
Use `otelop stop` to stop it. `startup status` reports the registration on disk,
not whether the server is running.
