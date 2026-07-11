import { useCallback } from "react";
import { useSetAtom, useStore } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { setLogPageAtom, appendLogsAtom, logsAtom } from "@/stores/telemetry";
import type { LogData } from "@/types/telemetry";
import type { ChartTimeRange } from "@/lib/chart-time-range";
import { useSignalListPage, type FetchPageArgs, type SignalListPage } from "./use-signal-list-page";

// Same field selection as use-initial-load.ts's old logs query. This query
// replaces it as the logs tab's data source now that the list is paginated
// by range instead of fetched unbounded (issue #160).
const LogsPageQuery = graphql(`
  query LogsPage($from: Time, $to: Time!, $offset: Int!, $limit: Int!, $search: String) {
    logs(from: $from, to: $to, offset: $offset, limit: $limit, search: $search) {
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
  const setLogPage = useSetAtom(setLogPageAtom);
  const appendLogs = useSetAtom(appendLogsAtom);
  const store = useStore();

  const fetchPage = useCallback(async ({ from, to, offset, limit, search }: FetchPageArgs) => {
    const data = await gqlClient.request(LogsPageQuery, { from, to, offset, limit, search });
    return { items: data.logs.items, total: data.logs.total };
  }, []);
  const getCurrentIds = useCallback(
    () => new Set(store.get(logsAtom).map((log) => log.id)),
    [store],
  );
  const replacePage = useCallback(
    (items: LogData[], idsAtRequestStart: ReadonlySet<string>) =>
      setLogPage({ items, idsAtRequestStart }),
    [setLogPage],
  );

  return useSignalListPage({
    range,
    search,
    fetchPage,
    getCurrentIds,
    onPage1: replacePage,
    onAppend: appendLogs,
  });
}
