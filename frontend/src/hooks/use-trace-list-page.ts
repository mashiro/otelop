import { useCallback } from "react";
import { useSetAtom, useStore } from "jotai";
import { graphql } from "@/gql";
import type { TracesPageQuery as TracesPageQueryType } from "@/gql/graphql";
import { gqlClient } from "@/lib/graphql";
import { replaceTracePageAtom, appendTracesAtom, tracesAtom } from "@/stores/telemetry";
import type { EventTimeWindow } from "@/lib/event-time-window";
import type { TraceData, SpanStatus } from "@/types/telemetry";
import { MS_TO_NS } from "@/lib/span-mapping";
import {
  useSignalListPage,
  type FetchPageArgs,
  type ReplacementPage,
  type SignalListPage,
} from "./use-signal-list-page";

// Same summary-only field selection as use-initial-load.ts's old traces
// query (no `spans` — see that file's N+1 comment); this query replaces it
// as the traces tab's data source now that the list is paginated by range
// instead of fetched unbounded.
const TracesPageQuery = graphql(`
  query TracesPage($from: Time, $to: Time!, $after: String, $limit: Int!, $search: String) {
    traces(from: $from, to: $to, after: $after, limit: $limit, search: $search) {
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
      hasNextPage
      endCursor
    }
  }
`);

function toTraceData({
  durationMs,
  rootSpan,
  ...rest
}: TracesPageQueryType["traces"]["items"][number]): TraceData {
  return {
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
    // Full span data is fetched lazily once a trace's detail view (or the
    // service map) actually needs it — see hooks/use-trace-spans.ts and
    // hooks/use-service-map-spans.ts.
    spans: [],
  };
}

// Fetches the traces tab's list page-by-page within `range`, matching
// `search` server-side (issue #161), replacing hooks/use-initial-load.ts's
// old unbounded `traces(limit: 0)` fetch (issue #160). Mount this once from
// components/traces/trace-list.tsx; base-ui's Tabs unmounts an inactive
// tab's panel (see App.tsx), so switching tabs and back naturally resets
// pagination the same way a range change does.
export function useTraceListPage(window: EventTimeWindow, search: string): SignalListPage {
  const replaceTracePage = useSetAtom(replaceTracePageAtom);
  const appendTraces = useSetAtom(appendTracesAtom);
  const store = useStore();

  const fetchPage = useCallback(async ({ from, to, after, limit, search }: FetchPageArgs) => {
    const data = await gqlClient.request(TracesPageQuery, { from, to, after, limit, search });
    return {
      items: data.traces.items.map(toTraceData),
      hasNextPage: data.traces.hasNextPage,
      endCursor: data.traces.endCursor ?? null,
    };
  }, []);
  const getCurrentIds = useCallback(
    () => new Set(store.get(tracesAtom).map((trace) => trace.traceId)),
    [store],
  );
  const replacePage = useCallback(
    (page: ReplacementPage<TraceData>) => replaceTracePage(page),
    [replaceTracePage],
  );

  return useSignalListPage({
    window,
    search,
    fetchPage,
    getCurrentIds,
    replacePage,
    onAppend: appendTraces,
  });
}
