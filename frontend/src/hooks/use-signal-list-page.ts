import { useCallback, useEffect, useRef, useState } from "react";
import { eventWindowBounds, eventWindowKey, type EventTimeWindow } from "@/lib/event-time-window";

// Page size for the traces/logs tabs' server-side pagination (issue #160).
// Small enough that the initial page load stays cheap even against 7d of
// retained history, big enough that "Load more" isn't needed for a typical
// recent-activity glance.
const SIGNAL_PAGE_SIZE = 100;

export interface SignalListPage {
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
  after: string | null;
  limit: number;
  search: string;
}

interface FetchPageResult<T> {
  items: T[];
  hasNextPage: boolean;
  endCursor: string | null;
}

interface PagingSession {
  from: string | undefined;
  to: string;
  search: string;
  endCursor: string | null;
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
// replacePage), then pages further into the past via the server cursor on
// "Load more" (appending via onAppend). `from`/`to`/`search` are captured once
// per range-or-search change. A
// search edit while a "Load more" is in flight starts a fresh session rather
// than mixing cursors from two different filters.
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
  const [state, setState] = useState({ hasMore: false, loaded: 0, loadingMore: false });
  const sessionRef = useRef<PagingSession | null>(null);
  const windowKey = eventWindowKey(window);

  useEffect(() => {
    let ignore = false;
    const bounds = eventWindowBounds(window);
    const session: PagingSession = {
      from: bounds.from,
      to: bounds.to,
      search,
      endCursor: null,
    };
    sessionRef.current = session;
    const idsBeforeRequest = getCurrentIds();

    const load = async () => {
      try {
        const { items, hasNextPage, endCursor } = await fetchPage({
          from: session.from,
          to: session.to,
          after: null,
          limit: SIGNAL_PAGE_SIZE,
          search: session.search,
        });
        if (ignore) return;
        replacePage({ items, idsBeforeRequest, window });
        session.endCursor = endCursor;
        setState({ hasMore: hasNextPage, loaded: items.length, loadingMore: false });
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
    const after = session.endCursor;
    const load = async () => {
      try {
        const { items, hasNextPage, endCursor } = await fetchPage({
          from: session.from,
          to: session.to,
          after,
          limit: SIGNAL_PAGE_SIZE,
          search: session.search,
        });
        if (sessionRef.current !== session) return;
        onAppend(items);
        session.endCursor = endCursor;
        setState((s) => ({
          hasMore: hasNextPage,
          loaded: s.loaded + items.length,
          loadingMore: false,
        }));
      } catch {
        if (sessionRef.current !== session) return;
        setState((s) => ({ ...s, loadingMore: false }));
      }
    };
    void load();
  }, [fetchPage, onAppend]);

  return {
    loaded: state.loaded,
    hasMore: state.hasMore,
    loadingMore: state.loadingMore,
    loadMore,
  };
}
