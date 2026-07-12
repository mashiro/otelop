import { useCallback, useEffect, useRef, useState } from "react";
import { eventWindowBounds, eventWindowKey, type EventTimeWindow } from "@/lib/event-time-window";

// Page size for the traces/logs tabs' server-side pagination (issue #160).
// Small enough that the initial page load stays cheap even against 7d of
// retained history, big enough that "Load more" isn't needed for a typical
// recent-activity glance.
const SIGNAL_PAGE_SIZE = 100;

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

// Exported so the traces/logs wrapper hooks (use-trace-list-page.ts,
// use-log-list-page.ts) can type their fetchPage callback against the exact
// shape this hook calls it with, instead of re-declaring the same inline type.
export interface FetchPageArgs {
  from: string | undefined;
  to: string;
  offset: number;
  limit: number;
  search: string;
}

interface FetchPageResult<T> {
  items: T[];
  total: number;
}

interface PagingSession {
  from: string | undefined;
  to: string;
  search: string;
  offset: number;
}

interface SignalListPageOptions<T> {
  window: EventTimeWindow;
  search: string;
  fetchPage: (args: FetchPageArgs) => Promise<FetchPageResult<T>>;
  getCurrentIds: () => ReadonlySet<string>;
  replacePage: (page: ReplacementPage<T>) => void;
  onAppend: (items: T[]) => void;
}

export interface ReplacementPage<T> {
  items: T[];
  idsBeforeRequest: ReadonlySet<string>;
  window: EventTimeWindow;
}

// Shared pagination core for the traces/logs list tabs
// (hooks/use-trace-list-page.ts, hooks/use-log-list-page.ts): fetches the
// newest SIGNAL_PAGE_SIZE-row page within `range` (and, since issue #161,
// matching `search`) on mount and whenever either changes (replacing via
// replacePage), then pages further into the past via `fetchPage`'s offset on
// "Load more" (appending via onAppend). `from`/`to`/`search` are captured once
// per range-or-search change (not recomputed on "Load more") so offsets stay
// consistent across the whole paging session for that combination — a
// search edit while a "Load more" is in flight starts a fresh session rather
// than mixing offsets from two different filters.
//
// Deliberately doesn't clear anything before a range/search-change fetch
// resolves — the previously loaded page (already sitting in
// tracesAtom/logsAtom) keeps rendering until the new one arrives, matching
// the keep-previous-data style used elsewhere (see
// hooks/use-metric-range-points.ts).
export function useSignalListPage<T>({
  window,
  search,
  fetchPage,
  getCurrentIds,
  replacePage,
  onAppend,
}: SignalListPageOptions<T>): SignalListPage {
  const [state, setState] = useState({ total: 0, loaded: 0, loadingMore: false });
  const sessionRef = useRef<PagingSession | null>(null);
  const windowKey = eventWindowKey(window);

  useEffect(() => {
    let ignore = false;
    const bounds = eventWindowBounds(window);
    const session: PagingSession = {
      from: bounds.from,
      to: bounds.to,
      search,
      offset: 0,
    };
    sessionRef.current = session;
    const idsBeforeRequest = getCurrentIds();

    const load = async () => {
      try {
        const { items, total } = await fetchPage({
          from: session.from,
          to: session.to,
          offset: 0,
          limit: SIGNAL_PAGE_SIZE,
          search: session.search,
        });
        if (ignore) return;
        replacePage({ items, idsBeforeRequest, window });
        session.offset = items.length;
        setState({ total, loaded: items.length, loadingMore: false });
      } catch {
        // Leave whatever was showing before (the previous range's page, or
        // just the live buffer) — the next range/search/tab activation retries.
      }
    };
    void load();

    return () => {
      ignore = true;
    };
    // fetchPage/replacePage/onAppend must be reference-stable across renders
    // (callers wrap them in useCallback or use Jotai setters) so this effect
    // only reruns on a genuine window or search change, not on every render.
  }, [windowKey, search, fetchPage, getCurrentIds, replacePage]);

  const loadMore = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    setState((s) => ({ ...s, loadingMore: true }));
    const offset = session.offset;
    const load = async () => {
      try {
        const { items, total } = await fetchPage({
          from: session.from,
          to: session.to,
          offset,
          limit: SIGNAL_PAGE_SIZE,
          search: session.search,
        });
        if (sessionRef.current !== session) return;
        onAppend(items);
        session.offset = offset + items.length;
        setState((s) => ({ total, loaded: s.loaded + items.length, loadingMore: false }));
      } catch {
        if (sessionRef.current !== session) return;
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
