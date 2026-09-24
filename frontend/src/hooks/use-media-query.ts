import { useSyncExternalStore } from "react";

interface MediaQuery {
  list: MediaQueryList;
  subscribe: (onChange: () => void) => () => void;
}

// One list and one subscribe function per query, shared by every caller, so
// useSyncExternalStore sees a stable subscribe and never re-registers the
// change listener on re-render.
const queries = new Map<string, MediaQuery>();

function mediaQuery(query: string): MediaQuery {
  let entry = queries.get(query);
  if (!entry) {
    const list = window.matchMedia(query);
    entry = {
      list,
      subscribe: (onChange) => {
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
      },
    };
    queries.set(query, entry);
  }
  return entry;
}

export function useMediaQuery(query: string): boolean {
  const { list, subscribe } = mediaQuery(query);
  return useSyncExternalStore(subscribe, () => list.matches);
}
