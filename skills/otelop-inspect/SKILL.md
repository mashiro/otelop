---
name: otelop-inspect
description: Investigate OpenTelemetry signals (traces, metrics, logs) retained by a locally running otelop instance via its GraphQL API. Use this when the user is debugging an app that sends telemetry to otelop and you need to inspect spans, correlate logs with traces, or read metric values.
---

# Investigate telemetry with otelop

1. Run `otelop docs list --json` to discover documentation bundled with the
   installed CLI.
2. Read `otelop docs show investigate-telemetry` before querying signals.
3. Also read `otelop docs show troubleshooting` when diagnosing missing data or
   connection failures, and `otelop docs show configuration` when endpoint or
   retention settings matter.
4. Follow the bundled documentation to query the GraphQL API. Request only the
   fields and time range needed for the investigation.

Prefer read-only public surfaces: `otelop status`, the GraphQL API, and the
browser UI. Use the address reported by `otelop status`; do not assume the
default port.

Do not start, restart, or stop otelop without the user's permission. Never call
the irreversible `clearSignals` mutation unless the user explicitly requests
deletion of all retained telemetry.

If the installed CLI does not support `otelop docs`, report that its bundled
documentation is unavailable instead of relying on potentially mismatched
schema details from the skill.
