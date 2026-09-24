import { useSyncExternalStore } from "react";

// One MediaQueryList per query, shared by every subscriber, so rendering and
// useSyncExternalStore's snapshot checks don't re-parse the query each time.
const lists = new Map<string, MediaQueryList>();

function mediaQueryList(query: string): MediaQueryList {
  let list = lists.get(query);
  if (!list) {
    list = window.matchMedia(query);
    lists.set(query, list);
  }
  return list;
}

export function useMediaQuery(query: string): boolean {
  const list = mediaQueryList(query);
  return useSyncExternalStore(
    (onChange) => {
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => list.matches,
  );
}
