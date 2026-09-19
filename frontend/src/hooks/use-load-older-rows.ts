import { useState } from "react";
import type { RenderWindow } from "./use-render-window";
import type { SignalListPage } from "./use-signal-list-page";

interface UseLoadOlderRowsOptions<T> {
  renderWindow: RenderWindow<T>;
  page: SignalListPage;
  // Newest-first, already-filtered list backing `renderWindow` — see
  // hooks/use-render-window.ts's `slideOlder` for why this is passed in
  // fresh on every call rather than read from a ref.
  items: T[];
}

export interface LoadOlderRows {
  loadMore: () => void;
  canLoadMore: boolean;
}

// "Load more" prefers rows the store already has: slide the render window
// onto them (instant, no fetch), and only fetch the next page from the
// server once none are left, then slide once that fetch lands.
// hooks/use-signal-list-page.ts's loadMore is fire-and-forget (its return
// value can't be awaited — see that file), so "slide once the fetch lands"
// is done by watching `loadingMore` fall back to false instead of awaiting
// anything: React's "storing information from previous renders" pattern
// (state adjustment during render, not a useEffect) — by the render where
// loadingMore turns false, `items` already reflects the freshly appended
// rows (onAppend runs synchronously before that state flips in
// use-signal-list-page.ts).
export function useLoadOlderRows<T>({
  renderWindow,
  page,
  items,
}: UseLoadOlderRowsOptions<T>): LoadOlderRows {
  const [pendingSlide, setPendingSlide] = useState(false);
  const [wasLoadingMore, setWasLoadingMore] = useState(page.loadingMore);
  if (page.loadingMore !== wasLoadingMore) {
    setWasLoadingMore(page.loadingMore);
    if (pendingSlide && !page.loadingMore) {
      setPendingSlide(false);
      renderWindow.slideOlder(items);
    }
  }

  const loadMore = () => {
    if (renderWindow.olderCount > 0) {
      renderWindow.slideOlder(items);
      return;
    }
    if (page.hasMore) {
      setPendingSlide(true);
      page.loadMore();
    }
  };

  return { loadMore, canLoadMore: renderWindow.olderCount > 0 || page.hasMore };
}
