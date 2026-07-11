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
  query LogsPage($from: Time, $offset: Int!, $limit: Int!) {
    logs(from: $from, offset: $offset, limit: $limit) {
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

// Fetches the logs tab's list page-by-page within `range`, replacing
// hooks/use-initial-load.ts's old unbounded `logs(limit: 0)` fetch. Mount
// this once from components/logs/log-list.tsx; base-ui's Tabs unmounts an
// inactive tab's panel (see App.tsx), so switching tabs and back naturally
// resets pagination the same way a range change does.
export function useLogListPage(range: ChartTimeRange): SignalListPage {
  const setLogs = useSetAtom(setLogsAtom);
  const appendLogs = useSetAtom(appendLogsAtom);

  const fetchPage = useCallback(
    async ({
      from,
      offset,
      limit,
    }: {
      from: string | undefined;
      offset: number;
      limit: number;
    }) => {
      const data = await gqlClient.request(LogsPageQuery, { from, offset, limit });
      return { items: data.logs.items, total: data.logs.total };
    },
    [],
  );

  return useSignalListPage(range, fetchPage, setLogs, appendLogs);
}
