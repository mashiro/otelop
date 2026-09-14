import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { mergeTraceSpansAtom } from "@/stores/telemetry";
import { toSpan } from "@/lib/span-mapping";
import type { TraceData } from "@/types/telemetry";

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
  const mergeSpans = useSetAtom(mergeTraceSpansAtom);
  const traceId = trace?.traceId;
  const needsSpans = Boolean(trace && trace.spans.length < trace.spanCount);
  const { data, isFetching } = useQuery(
    {
      queryKey: ["trace-spans", traceId, trace?.spanCount],
      queryFn: () => gqlClient.request(TraceSpansQuery, { traceId: traceId! }),
      enabled: needsSpans,
    },
    queryClient,
  );
  useEffect(() => {
    if (needsSpans && !isFetching && traceId && data?.trace)
      mergeSpans({ traceId, spans: data.trace.spans.map(toSpan) });
  }, [data, isFetching, needsSpans, traceId, mergeSpans]);
}
