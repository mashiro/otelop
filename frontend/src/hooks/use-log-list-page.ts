import { useCallback } from "react";
import { useSetAtom, useStore } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { replaceLogPageAtom, appendLogsAtom, logsAtom } from "@/stores/telemetry";
import type { LogData } from "@/types/telemetry";
import type { EventTimeWindow } from "@/lib/event-time-window";
import {
  useSignalListPage,
  type FetchPageArgs,
  type ReplacementPage,
  type SignalListPage,
} from "./use-signal-list-page";

// Same field selection as use-initial-load.ts's old logs query. This query
// replaces it as the logs tab's data source now that the list is paginated
// by range instead of fetched unbounded (issue #160).
const LogsPageQuery = graphql(`
  query LogsPage($from: Time, $to: Time!, $after: String, $limit: Int!, $search: String) {
    logs(from: $from, to: $to, after: $after, limit: $limit, search: $search) {
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
      hasNextPage
      endCursor
    }
  }
`);

// Fetches the logs tab's list page-by-page within `range`, matching `search`
// server-side (issue #161), replacing hooks/use-initial-load.ts's old
// unbounded `logs(limit: 0)` fetch. Mount this once from
// components/logs/log-list.tsx; base-ui's Tabs unmounts an inactive tab's
// panel (see App.tsx), so switching tabs and back naturally resets
// pagination the same way a range change does.
export function useLogListPage(window: EventTimeWindow, search: string): SignalListPage {
  const replaceLogPage = useSetAtom(replaceLogPageAtom);
  const appendLogs = useSetAtom(appendLogsAtom);
  const store = useStore();

  const fetchPage = useCallback(async ({ from, to, after, limit, search }: FetchPageArgs) => {
    const data = await gqlClient.request(LogsPageQuery, { from, to, after, limit, search });
    return {
      items: data.logs.items,
      hasNextPage: data.logs.hasNextPage,
      endCursor: data.logs.endCursor ?? null,
    };
  }, []);
  const getCurrentIds = useCallback(
    () => new Set(store.get(logsAtom).map((log) => log.id)),
    [store],
  );
  const replacePage = useCallback(
    (page: ReplacementPage<LogData>) => replaceLogPage(page),
    [replaceLogPage],
  );

  return useSignalListPage({
    window,
    search,
    fetchPage,
    getCurrentIds,
    replacePage,
    onAppend: appendLogs,
    loadOlderBeyondWindow: true,
  });
}
