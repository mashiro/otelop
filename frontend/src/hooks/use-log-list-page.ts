import { useCallback } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { setLogsAtom, appendLogsAtom } from "@/stores/telemetry";
import type { ChartTimeRange } from "@/lib/chart-time-range";
import { useSignalListPage, type SignalListPage } from "./use-signal-list-page";

// Same field selection as use-initial-load.ts's old logs query. This query
// replaces it as the logs tab's data source now that the list is paginated
// by range instead of fetched unbounded (issue #160).
const LogsPageQuery = graphql(`
  query LogsPage($from: Time, $offset: Int!, $limit: Int!, $search: String) {
    logs(from: $from, offset: $offset, limit: $limit, search: $search) {
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
      total
    }
  }
`);

// Fetches the logs tab's list page-by-page within `range`, matching `search`
// server-side (issue #161), replacing hooks/use-initial-load.ts's old
// unbounded `logs(limit: 0)` fetch. Mount this once from
// components/logs/log-list.tsx; base-ui's Tabs unmounts an inactive tab's
// panel (see App.tsx), so switching tabs and back naturally resets
// pagination the same way a range change does.
export function useLogListPage(range: ChartTimeRange, search: string): SignalListPage {
  const setLogs = useSetAtom(setLogsAtom);
  const appendLogs = useSetAtom(appendLogsAtom);

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
      const data = await gqlClient.request(LogsPageQuery, { from, offset, limit, search });
      return { items: data.logs.items, total: data.logs.total };
    },
    [],
  );

  return useSignalListPage(range, search, fetchPage, setLogs, appendLogs);
}
