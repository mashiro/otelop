import { useCallback } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import type { TracesPageQuery as TracesPageQueryType } from "@/gql/graphql";
import { gqlClient } from "@/lib/graphql";
import { setTracesAtom, appendTracesAtom } from "@/stores/telemetry";
import type { ChartTimeRange } from "@/lib/chart-time-range";
import type { TraceData, SpanStatus } from "@/types/telemetry";
import { useSignalListPage, type SignalListPage } from "./use-signal-list-page";

// See use-initial-load.ts's MS_TO_NS comment: GraphQL reports durationMs,
// the frontend type carries nanoseconds.
const MS_TO_NS = 1_000_000;

// Same summary-only field selection as use-initial-load.ts's old traces
// query (no `spans` — see that file's N+1 comment); this query replaces it
// as the traces tab's data source now that the list is paginated by range
// instead of fetched unbounded.
const TracesPageQuery = graphql(`
  query TracesPage($from: Time, $offset: Int!, $limit: Int!, $search: String) {
    traces(from: $from, offset: $offset, limit: $limit, search: $search) {
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
      total
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
export function useTraceListPage(range: ChartTimeRange, search: string): SignalListPage {
  const setTraces = useSetAtom(setTracesAtom);
  const appendTraces = useSetAtom(appendTracesAtom);

  const fetchPage = useCallback(
    async ({
      from,
      offset,
      limit,
      search,
    }: {
      from: string | undefined;
      offset: number;
      limit: number;
      search: string;
    }) => {
      const data = await gqlClient.request(TracesPageQuery, { from, offset, limit, search });
      return { items: data.traces.items.map(toTraceData), total: data.traces.total };
    },
    [],
  );

  return useSignalListPage(range, search, fetchPage, setTraces, appendTraces);
}
