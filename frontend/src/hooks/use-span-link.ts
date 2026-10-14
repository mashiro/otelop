import { useQuery } from "@tanstack/react-query";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { queryClient } from "@/lib/query-client";
import type { SpanLinkIdentity } from "@/lib/span-link-selection";
import type { TraceDeleteData } from "@/types/telemetry";
import { useTelemetryQueryUpdates, telemetryRefreshOptions } from "./use-telemetry-query-updates";

const SpanLinkQuery = graphql(`
  query SpanLink($sourceTraceId: ID!, $sourceSpanId: ID!, $ordinal: Int!) {
    spanLink(sourceTraceId: $sourceTraceId, sourceSpanId: $sourceSpanId, ordinal: $ordinal) {
      ordinal
      sourceTraceId
      sourceSpanId
      traceId
      spanId
      attributes
      droppedAttributesCount
      flags
      traceFlags
      isRemote
      traceState
      targetStatus
      source {
        traceId
        spanId
        name
        serviceName
      }
      target {
        traceId
        spanId
        name
        serviceName
      }
    }
  }
`);

export function useSpanLink(identity: SpanLinkIdentity) {
  const queryKey = [
    "span-link",
    identity.sourceTraceId,
    identity.sourceSpanId,
    identity.ordinal,
  ] as const;
  const query = useQuery(
    {
      queryKey,
      queryFn: async () => (await gqlClient.request(SpanLinkQuery, identity)).spanLink,
      ...telemetryRefreshOptions,
    },
    queryClient,
  );
  useTelemetryQueryUpdates(queryKey, (message) => {
    if (message.type !== "traces" && message.type !== "trace-deletes") return false;
    const { traceId } = message.data as TraceDeleteData;
    return traceId === identity.sourceTraceId || traceId === query.data?.traceId;
  });
  return query;
}
