import { useCallback, useEffect, useState } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import type { TraceByIdQuery } from "@/gql/graphql";
import { gqlClient } from "@/lib/graphql";
import { MS_TO_NS, toSpan } from "@/lib/span-mapping";
import { cacheTraceAtom } from "@/stores/telemetry";
import type { SpanStatus, TraceData } from "@/types/telemetry";

const TraceByIdQuery = graphql(`
  query TraceById($traceId: ID!) {
    trace(traceId: $traceId) {
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
      spans {
        ...SpanFields
      }
    }
  }
`);

export type TraceByIdStatus = "idle" | "loading" | "not-found" | "error";

interface LoadState {
  traceId: string | null;
  attempt: number;
  status: TraceByIdStatus;
}

function toTraceData(trace: NonNullable<TraceByIdQuery["trace"]>): TraceData {
  return {
    traceId: trace.traceId,
    serviceName: trace.serviceName,
    spanCount: trace.spanCount,
    startTime: trace.startTime,
    duration: trace.durationMs * MS_TO_NS,
    rootSpan: trace.rootSpan
      ? {
          name: trace.rootSpan.name,
          kind: trace.rootSpan.kind,
          statusCode: trace.rootSpan.statusCode as SpanStatus,
          duration: trace.rootSpan.durationMs * MS_TO_NS,
        }
      : undefined,
    spans: trace.spans.map(toSpan),
  };
}

async function loadTrace(traceId: string) {
  const data = await gqlClient.request(TraceByIdQuery, { traceId });
  return data.trace;
}

// Resolves a selected trace that is outside the traces tab's current
// time-window/page buffer. The focused query also makes deep-linked trace IDs
// independent of whichever list page happens to load first.
export function useTraceById(traceId: string | null, trace: TraceData | null) {
  const cacheTrace = useSetAtom(cacheTraceAtom);
  const [state, setState] = useState<LoadState>(() => ({
    traceId,
    attempt: 0,
    status: traceId && !trace ? "loading" : "idle",
  }));

  if (state.traceId !== traceId) {
    setState({ traceId, attempt: 0, status: traceId && !trace ? "loading" : "idle" });
  }

  const current =
    state.traceId === traceId
      ? state
      : {
          traceId,
          attempt: 0,
          status: traceId && !trace ? ("loading" as const) : ("idle" as const),
        };

  useEffect(() => {
    if (!traceId || trace) return;

    let ignore = false;
    const load = async () => {
      try {
        const result = await loadTrace(traceId);
        if (ignore) return;
        if (!result) {
          setState({ traceId, attempt: current.attempt, status: "not-found" });
          return;
        }
        cacheTrace(toTraceData(result));
      } catch {
        if (!ignore) setState({ traceId, attempt: current.attempt, status: "error" });
      }
    };
    void load();

    return () => {
      ignore = true;
    };
  }, [traceId, trace, current.attempt, cacheTrace]);

  const retry = useCallback(() => {
    if (!traceId) return;
    setState((previous) => ({
      traceId,
      attempt: previous.traceId === traceId ? previous.attempt + 1 : 0,
      status: "loading",
    }));
  }, [traceId]);

  return { status: trace ? "idle" : current.status, retry };
}
