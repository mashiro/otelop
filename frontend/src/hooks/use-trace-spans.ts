import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { replaceTraceSpansAtom } from "@/stores/telemetry";
import { toSpan } from "@/lib/span-mapping";
import { useTelemetryQueryUpdates, telemetryRefreshOptions } from "./use-telemetry-query-updates";
import type { TraceData, TraceDeleteData } from "@/types/telemetry";

const TraceSpansQuery = graphql(`
  query TraceSpans($traceId: ID!) {
    trace(traceId: $traceId) {
      spans {
        ...SpanFields
      }
    }
  }
`);

export function useTraceSpans(trace: TraceData | null): void {
  const replaceSpans = useSetAtom(replaceTraceSpansAtom);
  const traceId = trace?.traceId;
  const queryKey = ["trace-spans", traceId] as const;
  const { data, isFetching } = useQuery(
    {
      queryKey,
      queryFn: () => gqlClient.request(TraceSpansQuery, { traceId: traceId! }),
      enabled: Boolean(traceId),
      ...telemetryRefreshOptions,
    },
    queryClient,
  );
  useTelemetryQueryUpdates(
    queryKey,
    (message) =>
      (message.type === "traces" || message.type === "trace-deletes") &&
      (message.data as TraceDeleteData).traceId === traceId,
  );
  useEffect(() => {
    if (!isFetching && traceId && data)
      replaceSpans({ traceId, spans: data.trace?.spans.map(toSpan) ?? [] });
  }, [data, isFetching, traceId, replaceSpans]);
}
