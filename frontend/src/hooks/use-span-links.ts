import { useInfiniteQuery } from "@tanstack/react-query";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { queryClient } from "@/lib/query-client";
import { useTelemetryQueryUpdates, telemetryRefreshOptions } from "./use-telemetry-query-updates";
import type { TraceDeliveryWire, TraceDeleteData, WsMessage } from "@/types/telemetry";

const SpanLinksQuery = graphql(`
  query SpanLinks($traceId: ID!, $spanId: ID!, $after: String, $incoming: Boolean!) {
    trace(traceId: $traceId) {
      span(spanId: $spanId) {
        links(first: 20, after: $after) @skip(if: $incoming) {
          ...LinkPage
        }
        incomingLinks(first: 20, after: $after) @include(if: $incoming) {
          ...LinkPage
        }
      }
    }
  }
  fragment LinkPage on SpanLinkConnection {
    hasNextPage
    endCursor
    items {
      ordinal
      traceId
      spanId
      sourceTraceId
      sourceSpanId
      targetStatus
      target {
        traceId
        spanId
        name
        serviceName
      }
      source {
        traceId
        spanId
        name
        serviceName
      }
    }
  }
`);

export function useSpanLinks(traceId: string, spanId: string, incoming: boolean) {
  const queryKey = ["span-links", traceId, spanId, incoming] as const;
  const query = useInfiniteQuery(
    {
      queryKey,
      initialPageParam: null as string | null,
      queryFn: async ({ pageParam }) => {
        const data = await gqlClient.request(SpanLinksQuery, {
          traceId,
          spanId,
          incoming,
          after: pageParam,
        });
        const span = data.trace?.span;
        if (!span) return { available: false, items: [], hasNextPage: false, endCursor: null };
        return { ...(incoming ? span.incomingLinks : span.links)!, available: true };
      },
      getNextPageParam: (page) => (page.hasNextPage ? page.endCursor : undefined),
      ...telemetryRefreshOptions,
    },
    queryClient,
  );
  const targetIds =
    query.data?.pages.flatMap((page) =>
      page.items.map((link) => (incoming ? link.sourceTraceId : link.traceId)),
    ) ?? [];
  useTelemetryQueryUpdates(queryKey, (message: WsMessage) => {
    if (message.type !== "traces" && message.type !== "trace-deletes") return false;
    const data = message.data as TraceDeliveryWire | TraceDeleteData;
    return (
      data.traceId === traceId ||
      targetIds.includes(data.traceId) ||
      (incoming &&
        message.type === "traces" &&
        !!(data as TraceDeliveryWire).linkTargets?.some(
          (target) => target.traceId === traceId && target.spanId === spanId,
        ))
    );
  });
  return query;
}
