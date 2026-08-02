---
description: Diagnose common otelop startup, connectivity, ingestion, storage, and hostname problems. Use when otelop is unreachable, telemetry is missing, or the UI and GraphQL API reject a request.
---
# Troubleshooting

Start with read-only diagnostics:

```sh
otelop status
otelop info
otelop logs
```

Do not start, restart, stop, or clear a user's otelop instance unless they asked
for that state change.

## The UI or GraphQL API is unreachable

- Read the actual Web UI address from `otelop status`; do not assume port 4319.
- A stale metadata message means the recorded process is no longer running.
  `otelop stop` removes stale metadata, but changes state and needs permission.
- The default HTTP listener is loopback-only. Remote clients need an explicit
  non-loopback `--http` address and appropriate network controls.

## A hostname is rejected

`/graphql` and `/ws` reject unknown `Host` headers to prevent DNS rebinding.
Add reverse-proxy or internal hostnames to `allowed_hosts`,
`--allowed-hosts`, or `OTELOP_ALLOWED_HOSTS`. IP literals and `localhost` do
not need an entry.

## Telemetry is missing

- Confirm the exporter protocol and port match: gRPC defaults to 4317 and
  HTTP/protobuf defaults to 4318.
- Inspect application exporter errors and `otelop logs`.
- Check the running instance's retention and size limits through GraphQL
  `status`; `otelop info` only shows the config file and built-in defaults.
  Cleanup can remove older data.
- Narrow the UI time window and clear any search filters.

## More detail

Run `otelop docs show configuration` for endpoint and storage settings, or
`otelop docs show investigate-telemetry` for GraphQL queries.
