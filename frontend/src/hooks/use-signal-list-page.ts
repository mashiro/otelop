import { useCallback, useEffect, useRef, useState } from "react";
import { eventWindowBounds, eventWindowKey, type EventTimeWindow } from "@/lib/event-time-window";

// Page size for the traces/logs tabs' server-side pagination (issue #160).
// Small enough that the initial page load stays cheap even against 7d of
// retained history, big enough that "Load more" isn't needed for a typical
// recent-activity glance.
const SIGNAL_PAGE_SIZE = 100;

export interface SignalListPage {
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}

// Exported so the traces/logs wrapper hooks (use-trace-list-page.ts,
// use-log-list-page.ts) can type their fetchPage callback against the exact
// shape this hook calls it with, instead of re-declaring the same inline type.
export interface FetchPageArgs {
  from: string | undefined;
  to: string | undefined;
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
  to: string | undefined;
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
  loadOlderBeyondWindow?: boolean;
  retainedHistory?: boolean;
}

export interface ReplacementPage<T> {
  items: T[];
  idsBeforeRequest: ReadonlySet<string>;
  window: EventTimeWindow;
}

// Shared pagination core for the traces/logs list tabs
// (hooks/use-trace-list-page.ts, hooks/use-log-list-page.ts): fetches the
// newest SIGNAL_PAGE_SIZE-row page within `range`, or across retained history
// when searching, on mount and whenever the active request scope changes
// (replacing via replacePage), then pages further into the past via the server cursor on
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
  loadOlderBeyondWindow = false,
  retainedHistory = false,
}: SignalListPageOptions<T>): SignalListPage {
  const [state, setState] = useState({ hasMore: false, loadingMore: false });
  const sessionRef = useRef<PagingSession | null>(null);
  const windowKey = eventWindowKey(window);
  const normalizedSearch = search.trim();
  // Search is a retained-history query mode, not a predicate applied inside
  // the currently selected browsing window. Keeping one key for that mode
  // also means an otherwise irrelevant range change cannot reset its cursor.
  const requestKey = normalizedSearch
    ? `search:${normalizedSearch}`
    : retainedHistory
      ? "retained"
      : `browse:${windowKey}`;

  useEffect(() => {
    let ignore = false;
    const bounds =
      normalizedSearch || retainedHistory
        ? { from: undefined, to: undefined }
        : eventWindowBounds(window);
    const session: PagingSession = {
      from: bounds.from,
      to: bounds.to,
      search: normalizedSearch,
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
        setState({
          hasMore: hasNextPage || (loadOlderBeyondWindow && session.from !== undefined),
          loadingMore: false,
        });
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
  }, [requestKey, fetchPage, getCurrentIds, replacePage, loadOlderBeyondWindow, retainedHistory]);

  const loadMore = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    setState((s) => ({ ...s, loadingMore: true }));
    const after = session.endCursor;
    const load = async () => {
      try {
        // Logs treat the selected window as the starting page, not a hard
        // history boundary. Once the user asks for more, continue from the
        // oldest loaded cursor without `from`; an empty first page starts at
        // the window's lower bound instead.
        const beyondWindow = loadOlderBeyondWindow && session.from !== undefined;
        const { items, hasNextPage, endCursor } = await fetchPage({
          from: beyondWindow ? undefined : session.from,
          to: beyondWindow && after === null ? session.from! : session.to,
          after,
          limit: SIGNAL_PAGE_SIZE,
          search: session.search,
        });
        if (sessionRef.current !== session) return;
        onAppend(items);
        session.endCursor = endCursor;
        setState({
          hasMore: hasNextPage,
          loadingMore: false,
        });
      } catch {
        if (sessionRef.current !== session) return;
        setState((s) => ({ ...s, loadingMore: false }));
      }
    };
    void load();
  }, [fetchPage, onAppend, loadOlderBeyondWindow]);

  return {
    hasMore: state.hasMore,
    loadingMore: state.loadingMore,
    loadMore,
  };
}
