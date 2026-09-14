import { queryOptions, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { useCallback, useEffect } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import type { TraceByIdQuery } from "@/gql/graphql";
import { gqlClient } from "@/lib/graphql";
import { MS_TO_NS, toSpan } from "@/lib/span-mapping";
import { normalizeTrace } from "@/lib/normalize";
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

function toTraceData(trace: NonNullable<TraceByIdQuery["trace"]>): TraceData {
  return normalizeTrace({
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
    // toSpan already normalizes each span; normalizeTrace's own per-span map
    // below just re-derives the same epoch values from startTime/endTime
    // (idempotent) rather than trusting them as pre-parsed, so this stays
    // the single normalizeTrace call site for every TraceData construction.
    spans: trace.spans.map(toSpan),
  });
}

async function loadTrace(traceId: string) {
  const data = await gqlClient.request(TraceByIdQuery, { traceId });
  return data.trace;
}

export const traceByIdOptions = (traceId: string) =>
  queryOptions({
    queryKey: ["trace", traceId],
    queryFn: () => loadTrace(traceId),
    staleTime: 1_000,
  });

// Resolves a selected trace that is outside the traces tab's current
// time-window/page buffer. The focused query also makes deep-linked trace IDs
// independent of whichever list page happens to load first.
export function useTraceById(traceId: string | null, trace: TraceData | null) {
  const cacheTrace = useSetAtom(cacheTraceAtom);
  const { data, isError, isFetching, refetch } = useQuery(
    {
      ...traceByIdOptions(traceId ?? ""),
      enabled: Boolean(traceId && !trace),
    },
    queryClient,
  );
  useEffect(() => {
    if (!trace && !isFetching && data) cacheTrace(toTraceData(data));
  }, [data, trace, isFetching, cacheTrace]);
  const retry = useCallback(() => {
    if (traceId) void refetch();
  }, [traceId, refetch]);
  const status: TraceByIdStatus =
    !traceId || trace
      ? "idle"
      : isFetching
        ? "loading"
        : isError
          ? "error"
          : data === null
            ? "not-found"
            : "loading";
  return { status, retry };
}
