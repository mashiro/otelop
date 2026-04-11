import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import type { SpanFieldsFragment } from "@/gql/graphql";
import { gqlClient } from "@/lib/graphql";
import { setTracesAtom, setMetricsAtom, setLogsAtom, serverConfigAtom } from "@/stores/telemetry";
import type { TraceData, SpanData } from "@/types/telemetry";

// GraphQL exposes durationMs (milliseconds, Float) while the frontend type
// carries `duration` in nanoseconds — matching how Go's time.Duration is still
// serialized over the WebSocket delta path. Scale at the fetch boundary so the
// downstream stores don't need to know about the two worlds.
const MS_TO_NS = 1_000_000;

const InitialLoadQuery = graphql(`
  query InitialLoad {
    config {
      traceCap
      metricCap
      logCap
      maxDataPoints
    }
    traces(limit: 0) {
      items {
        traceId
        serviceName
        spanCount
        startTime
        durationMs
        spans {
          ...SpanFields
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
          timestamp
          value
          count
          sum
          min
          max
          attributes
        }
      }
    }
    logs(limit: 0) {
      items {
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

function toSpan({ durationMs, ...rest }: SpanFieldsFragment): SpanData {
  return { ...rest, duration: durationMs * MS_TO_NS };
}

export function useInitialLoad() {
  const setTraces = useSetAtom(setTracesAtom);
  const setMetrics = useSetAtom(setMetricsAtom);
  const setLogs = useSetAtom(setLogsAtom);
  const setConfig = useSetAtom(serverConfigAtom);
  // StrictMode double-invokes effects in dev; guard so the bootstrap fetch
  // (and its Jotai writes) only runs once per real mount.
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const load = async () => {
      try {
        const data = await gqlClient.request(InitialLoadQuery);
        setConfig(data.config);

        const traces: TraceData[] = data.traces.items.map(
          ({ durationMs, spans: rawSpans, ...rest }) => {
            const spans = rawSpans.map(toSpan);
            return {
              ...rest,
              duration: durationMs * MS_TO_NS,
              // Mirror the Go resolver: rootSpan is the first span with no parent.
              // The query omits rootSpan to avoid shipping the same span twice.
              rootSpan: spans.find((s) => s.parentSpanId === ""),
              spans,
            };
          },
        );
        setTraces(traces);
        setMetrics(data.metrics.items);
        setLogs(data.logs.items);
      } catch {
        // WebSocket will deliver data later.
      }
    };
    void load();
  }, [setTraces, setMetrics, setLogs, setConfig]);
}
