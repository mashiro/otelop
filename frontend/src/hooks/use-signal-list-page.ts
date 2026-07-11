import { useCallback, useEffect, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { rangeToMs, type ChartTimeRange } from "@/lib/chart-time-range";

// Page size for the traces/logs tabs' server-side pagination (issue #160).
// Small enough that the initial page load stays cheap even against 7d of
// retained history, big enough that "Load more" isn't needed for a typical
// recent-activity glance.
export const SIGNAL_PAGE_SIZE = 100;

export interface SignalListPage {
  // Honest total row count within the fetched range, from the server
  // connection's `total` — distinct from the live buffer's length (which the
  // tab badge counters still use; see stores/telemetry.ts's traceCountAtom).
  total: number;
  // Rows fetched from the server across page 1 + every "Load more" so far —
  // NOT the live buffer's length, which can differ (WS deliveries grow it,
  // the client cap or the range display filter can shrink what's rendered).
  loaded: number;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}

interface FetchPageArgs {
  from: string | undefined;
  offset: number;
  limit: number;
}

interface FetchPageResult<T> {
  items: T[];
  total: number;
}

// Shared pagination core for the traces/logs list tabs
// (hooks/use-trace-list-page.ts, hooks/use-log-list-page.ts): fetches the
// newest SIGNAL_PAGE_SIZE-row page within `range` on mount and whenever
// `range` changes (replacing via onPage1), then pages further into the past
// via `fetchPage`'s offset on "Load more" (appending via onAppend). `from` is
// computed once per range (not recomputed on "Load more") so offsets stay
// consistent across the whole paging session for that range.
//
// Deliberately doesn't clear anything before a range-change fetch resolves —
// the previously loaded page (already sitting in tracesAtom/logsAtom) keeps
// rendering until the new one arrives, matching the
// keep-previous-data style used elsewhere (see hooks/use-metric-range-points.ts).
export function useSignalListPage<T>(
  range: ChartTimeRange,
  fetchPage: (args: FetchPageArgs) => Promise<FetchPageResult<T>>,
  onPage1: (items: T[]) => void,
  onAppend: (items: T[]) => void,
): SignalListPage {
  const [state, setState] = useState({ total: 0, loaded: 0, loadingMore: false });
  const offsetRef = useRef(0);
  const fromRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let ignore = false;
    const rangeMs = rangeToMs(range);
    const from =
      rangeMs === null
        ? undefined
        : Temporal.Now.instant().subtract({ milliseconds: rangeMs }).toString();
    fromRef.current = from;
    offsetRef.current = 0;

    const load = async () => {
      try {
        const { items, total } = await fetchPage({ from, offset: 0, limit: SIGNAL_PAGE_SIZE });
        if (ignore) return;
        onPage1(items);
        offsetRef.current = items.length;
        setState({ total, loaded: items.length, loadingMore: false });
      } catch {
        // Leave whatever was showing before (the previous range's page, or
        // just the live buffer) — the next range/tab activation retries.
      }
    };
    void load();

    return () => {
      ignore = true;
    };
    // fetchPage/onPage1/onAppend must be reference-stable across renders
    // (callers wrap fetchPage in useCallback([]); onPage1/onAppend are jotai
    // setters, already stable) so this effect only reruns on a genuine range
    // change, not on every render.
  }, [range, fetchPage, onPage1]);

  const loadMore = useCallback(() => {
    setState((s) => ({ ...s, loadingMore: true }));
    const offset = offsetRef.current;
    const load = async () => {
      try {
        const { items, total } = await fetchPage({
          from: fromRef.current,
          offset,
          limit: SIGNAL_PAGE_SIZE,
        });
        onAppend(items);
        offsetRef.current = offset + items.length;
        setState((s) => ({ total, loaded: s.loaded + items.length, loadingMore: false }));
      } catch {
        setState((s) => ({ ...s, loadingMore: false }));
      }
    };
    void load();
  }, [fetchPage, onAppend]);

  return {
    total: state.total,
    loaded: state.loaded,
    hasMore: state.loaded < state.total,
    loadingMore: state.loadingMore,
    loadMore,
  };
}
