import { useCallback, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { eventWindowBounds, eventWindowKey, type EventTimeWindow } from "@/lib/event-time-window";

// Page size for the traces/logs tabs' server-side pagination (issue #160).
// Small enough that the initial page load stays cheap even against 7d of
// retained history, big enough that "Load more" isn't needed for a typical
// recent-activity glance. Exported so components/common/load-more-row.tsx's
// callers (trace-list.tsx, log-list.tsx) can widen their render window by the
// same increment a fetched page adds, instead of picking an unrelated number.
export const SIGNAL_PAGE_SIZE = 100;

export interface SignalListPage {
  hasMore: boolean;
  loadingMore: boolean;
  // Fire-and-forget, deliberately NOT promise-returning: React's `act()`
  // treats a thenable return value from an updater specially, so making this
  // awaitable would force every existing `act(() => loadMore())` call site
  // (this hook's own tests) to switch to `await act(async () => ...)`.
  // trace-list.tsx/log-list.tsx detect completion by watching `loadingMore`
  // fall back to false instead — see their pendingSlide state.
  loadMore: () => void;
  // Identifies the current browsing/search scope (mirrors the internal
  // requestKey below). trace-list.tsx/log-list.tsx key their render-window
  // state off this so it resets exactly when this hook's own session resets
  // — a range or search change — rather than duplicating that logic.
  requestKey: string;
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

interface SignalListPageOptions<T> {
  queryScope: readonly unknown[];
  window: EventTimeWindow;
  search: string;
  fetchPage: (args: FetchPageArgs) => Promise<FetchPageResult<T>>;
  getCurrentIds: () => ReadonlySet<string>;
  replacePage: (page: ReplacementPage<T>) => void;
  onAppend: (items: T[]) => void;
  loadOlderBeyondWindow?: boolean;
  hasItemsBefore?: (before: string) => Promise<boolean>;
  retainedHistory?: boolean;
  searchWithinWindow?: boolean;
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
  queryScope,
  window,
  search,
  fetchPage,
  getCurrentIds,
  replacePage,
  onAppend,
  loadOlderBeyondWindow = false,
  hasItemsBefore,
  retainedHistory = false,
  searchWithinWindow = false,
}: SignalListPageOptions<T>): SignalListPage {
  const windowKey = eventWindowKey(window);
  const normalizedSearch = search.trim();
  const acrossHistory = retainedHistory || (Boolean(normalizedSearch) && !searchWithinWindow);
  const requestKey = acrossHistory
    ? `retained:${normalizedSearch}`
    : `window:${windowKey}:search:${normalizedSearch}`;
  // Resolve a relative range once per browsing scope so every cursor uses
  // the same time bounds, including when new live deliveries arrive.
  const bounds = useMemo(
    () => (acrossHistory ? { from: undefined, to: undefined } : eventWindowBounds(window)),
    [requestKey],
  );
  const query = useInfiniteQuery(
    {
      queryKey: ["signal-pages", ...queryScope, requestKey, bounds],
      initialPageParam: { after: null as string | null, initial: true },
      queryFn: async ({ pageParam, signal }) => {
        const beyondWindow =
          !pageParam.initial && loadOlderBeyondWindow && bounds.from !== undefined;
        const idsBeforeRequest = getCurrentIds();
        const page = await fetchPage({
          from: beyondWindow ? undefined : bounds.from,
          to: beyondWindow && pageParam.after === null ? bounds.from : bounds.to,
          after: pageParam.after,
          limit: SIGNAL_PAGE_SIZE,
          search: normalizedSearch,
        });
        const hasOlder =
          pageParam.initial &&
          !page.hasNextPage &&
          loadOlderBeyondWindow &&
          bounds.from !== undefined &&
          hasItemsBefore
            ? await hasItemsBefore(bounds.from).catch(() => true)
            : false;
        // Consumers slide the render window when Query finishes. Publish the
        // rows first, and ignore requests abandoned by a scope change/unmount.
        if (!signal.aborted) {
          if (pageParam.initial) replacePage({ items: page.items, idsBeforeRequest, window });
          else onAppend(page.items);
        }
        return {
          ...page,
          hasMore: page.hasNextPage || hasOlder,
        };
      },
      getNextPageParam: (page) =>
        page.hasMore ? { after: page.endCursor, initial: false } : undefined,
      // The live buffer is bounded separately; avoid retaining an unlimited
      // second copy of historical pages in the query cache.
      maxPages: 10,
      // A later visit starts from the newest page, not a cached cursor whose
      // head may already have been evicted by maxPages.
      gcTime: 0,
    },
    queryClient,
  );
  const { fetchNextPage } = query;
  const loadMore = useCallback(() => {
    void fetchNextPage({ cancelRefetch: false });
  }, [fetchNextPage]);
  return {
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore,
    requestKey,
  };
}
