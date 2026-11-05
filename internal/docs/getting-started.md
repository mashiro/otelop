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

This writes a macOS LaunchAgent or a systemd user unit and its
`default.target.wants` link. It takes effect when the next login starts a new
user session; it does not start a server immediately. On Linux, an existing
user manager (including one kept alive by lingering or another login) must
exit before the registration takes effect. Use `otelop start` to start now.
No administrator privileges are needed.

The registration runs `otelop start` once, using the absolute executable path,
working directory, configuration-file path, and XDG/state-directory overrides
recorded by `enable`. Keep the working directory available.
When a mise shim resolves to the current executable in the saved startup
context, registration uses that shim. It selects the configured version on each
login, so `mise upgrade` requires no re-registration, even if the old version is
removed. The recorded working directory determines which mise configuration is
used; project version pins still apply. Custom mise paths and environment/profile
selectors are preserved, but temporary per-tool version overrides are not.
Stable symlinks found on PATH are also preserved without resolving their targets.
Otherwise, registration uses the current executable path; moving that executable
requires running `enable` again.

Put runtime settings in the existing TOML configuration file. Shell variables
such as `OTELOP_HTTP` and proxy credentials are not copied into the registration;
configuration-file changes are read at the next start. When using a mise shim,
the shim also loads the mise configuration and its declared environment. Relative storage paths
are resolved from the recorded working directory. The server is not supervised
or automatically restarted after it exits. Continue to use `otelop status`,
`otelop logs`, `otelop restart`, and `otelop stop` to manage it.

Remove automatic startup with:

```sh
otelop startup disable
```

This affects future user sessions and leaves a currently running server alone.
Use `otelop stop` to stop it. `startup status` reports the registration on disk,
not whether the server is running.
