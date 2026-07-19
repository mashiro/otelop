import { useRef, useState } from "react";

export interface RenderWindow<T> {
  // The slice of `items` currently mounted — always <= max rows.
  visible: T[];
  // Rows above `visible` (more recent than the window's top row). >0 means
  // the window has been scrolled away from the head; components/common/
  // back-to-latest-row.tsx surfaces this count.
  newerCount: number;
  // Rows already loaded into `items` but below `visible` — sliding onto
  // these needs no fetch. 0 means the next "Load more" click (if any) must
  // fetch a new page first.
  olderCount: number;
  isHead: boolean;
  // Advances the window by one page, using the given (freshly-read) items —
  // see trace-list.tsx's fetch-then-slide handler for why the caller
  // supplies `items` explicitly rather than this hook re-reading it itself.
  slideOlder: (items: T[]) => void;
  backToLatest: () => void;
}

interface UseRenderWindowOptions<T> {
  // Newest-first, already-filtered list this window slices over.
  items: T[];
  getId: (item: T) => string;
  max: number;
  pageSize: number;
  // Changing this (a range/search/filter scope change) snaps the window
  // back to the head — see trace-list.tsx/log-list.tsx/metric-list.tsx for
  // what each passes.
  resetKey: string;
}

// Bounded sliding window over a list that's too large to mount every row of
// (stores/telemetry.ts's renderWindowMaxAtom rationale). Unlike a simple `slice(0, max)`, the
// window can move into history via "Load more" without growing without
// bound — it always mounts at most `max` rows.
//
// The window's position is anchored to the id of its top row, not a numeric
// index: a live row prepended at index 0 (stores/telemetry.ts's WS-driven
// buffers, newest-first) would otherwise silently shift a scrolled-down
// window's contents out from under the user. Re-resolving the anchor id's
// index every render keeps the *actual rows shown* stable while `newerCount`
// (rows now above them) grows — see components/common/back-to-latest-row.tsx.
export function useRenderWindow<T>({
  items,
  getId,
  max,
  pageSize,
  resetKey,
}: UseRenderWindowOptions<T>): RenderWindow<T> {
  const [anchorId, setAnchorId] = useState<string | null>(null);
  // React's "storing information from previous renders" pattern (see
  // trace-list.tsx's identical use for its own reset key) — adjusts state
  // during render instead of in a useEffect.
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  // Last index the anchor resolved to. Used only as a fallback when the
  // anchor row falls out of `items` (evicted by the live buffer's cap) —
  // "clamp to the nearest position" per hooks/use-render-window.ts's design.
  const lastKRef = useRef(0);

  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setAnchorId(null);
    lastKRef.current = 0;
  }

  const maxK = Math.max(0, items.length - max);
  let k = 0;
  if (anchorId !== null) {
    const idx = items.findIndex((item) => getId(item) === anchorId);
    k = idx !== -1 ? idx : Math.min(lastKRef.current, maxK);
  }
  k = Math.min(k, maxK);
  lastKRef.current = k;

  const visible = items.slice(k, k + max);

  return {
    visible,
    newerCount: k,
    olderCount: items.length - (k + visible.length),
    isHead: k === 0,
    slideOlder: (currentItems: T[]) => {
      // `k` was resolved against this render's `items`; Load more only ever
      // appends rows older than everything currently loaded (see
      // hooks/use-signal-list-page.ts), so the anchor row's index is still
      // valid in `currentItems` even when it's a fresher array read after an
      // intervening fetch.
      const nextMaxK = Math.max(0, currentItems.length - max);
      const nextK = Math.min(k + pageSize, nextMaxK);
      const nextAnchor = currentItems[nextK];
      setAnchorId(nextAnchor ? getId(nextAnchor) : null);
    },
    backToLatest: () => setAnchorId(null),
  };
}
