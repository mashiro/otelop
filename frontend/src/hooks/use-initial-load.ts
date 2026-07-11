import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { setTracesAtom, setMetricsAtom, setLogsAtom } from "@/stores/telemetry";
import type { TraceData, SpanStatus } from "@/types/telemetry";

// GraphQL exposes durationMs (milliseconds, Float) while the frontend type
// carries `duration` in nanoseconds — matching how Go's time.Duration is still
// serialized over the WebSocket delta path. Scale at the fetch boundary so the
// downstream stores don't need to know about the two worlds.
const MS_TO_NS = 1_000_000;

// Ring-buffer capacity config (traceCap/metricCap/logCap/maxDataPoints) was
// removed from the backend's Config type when storage moved to DuckDB with
// time-based retention (docs/design/duckdb-storage.md). The client-side caps
// that used to come from that query stay as fixed defaults in
// stores/telemetry.ts (DEFAULT_CONFIG) bounding this tab's live buffer;
// history beyond them is queryable from the server (see
// hooks/use-metric-range-points.ts).
// The traces selection here deliberately omits `spans`: requesting every
// buffered trace's full span list on every initial load is exactly the N+1
// self-telemetry surfaced (815 x Trace.spans -> 815 TraceByID SQL round
// trips, an ~800ms/861-span page-load trace — see
// internal/graphql/trace_resolver_test.go). Everything below resolves
// straight from the backend's TracesPage summary row with zero extra SQL
// (see trace_resolver.go's owner-backed SpanResolver), which is enough for
// the trace list to render every column. Full span data (for the detail
// waterfall/service map) is fetched lazily on demand — see
// hooks/use-trace-spans.ts.
const InitialLoadQuery = graphql(`
  query InitialLoad {
    traces(limit: 0) {
      items {
        traceId
        serviceName
        spanCount
        startTime
        durationMs
        rootSpan {
          name
          kind
          statusCode
          durationMs
        }
      }
    }
    metrics(limit: 0) {
      items {
        name
        description
        unit
        type
        serviceName
        resource
        receivedAt
        dataPoints {
          id
          timestamp
          value
          cumulative
          count
          countCumulative
          sum
          sumCumulative
          min
          max
          attributes
        }
      }
    }
    logs(limit: 0) {
      items {
        id
        timestamp
        observedTimestamp
        traceId
        spanId
        severityNumber
        severityText
        body
        serviceName
        attributes
        resource
      }
    }
  }

  fragment SpanFields on Span {
    traceId
    spanId
    parentSpanId
    name
    kind
    serviceName
    startTime
    endTime
    durationMs
    statusCode
    statusMessage
    attributes
    events {
      name
      timestamp
      attributes
    }
    resource
  }
`);

export function useInitialLoad() {
  const setTraces = useSetAtom(setTracesAtom);
  const setMetrics = useSetAtom(setMetricsAtom);
  const setLogs = useSetAtom(setLogsAtom);
  // StrictMode double-invokes effects in dev; guard so the bootstrap fetch
  // (and its Jotai writes) only runs once per real mount.
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const load = async () => {
      try {
        const data = await gqlClient.request(InitialLoadQuery);

        const traces: TraceData[] = data.traces.items.map(({ durationMs, rootSpan, ...rest }) => ({
          ...rest,
          duration: durationMs * MS_TO_NS,
          rootSpan: rootSpan
            ? {
                name: rootSpan.name,
                kind: rootSpan.kind,
                statusCode: rootSpan.statusCode as SpanStatus,
                duration: rootSpan.durationMs * MS_TO_NS,
              }
            : undefined,
          // Full span data is fetched lazily once a trace's detail view
          // (or the service map) actually needs it — see
          // hooks/use-trace-spans.ts and hooks/use-service-map-spans.ts.
          spans: [],
        }));
        setTraces(traces);
        setMetrics(data.metrics.items);
        setLogs(data.logs.items);
      } catch {
        // WebSocket will deliver data later.
      }
    };
    void load();
  }, [setTraces, setMetrics, setLogs]);
}
