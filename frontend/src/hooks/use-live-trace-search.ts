import { useEffect } from "react";
import { useStore } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { eventWindowBounds, eventWindowKey, type EventTimeWindow } from "@/lib/event-time-window";
import { liveTraceBatchAtom, tracesAtom, serverMatchedTraceIdsAtom } from "@/stores/telemetry";

const MatchingTraceIdsQuery = graphql(`
  query MatchingTraceIds($traceIds: [String!]!, $from: Time, $to: Time, $search: String!) {
    matchingTraceIds(traceIds: $traceIds, from: $from, to: $to, search: $search)
  }
`);

// Coalesce live updates; never fetch full spans or restart the user's paging
// cursor. Version each ID so a response cannot vouch for a newer update.
export function useLiveTraceSearch(window: EventTimeWindow, search: string) {
  const store = useStore();
  const key = eventWindowKey(window);
  useEffect(() => {
    if (!search.trim()) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let version = 0;
    let retryDelay = 500;
    const pending = new Map<string, number>();
    const schedule = () => {
      if (!disposed && !running && !timer && pending.size)
        timer = setTimeout(() => {
          timer = undefined;
          void run();
        }, retryDelay);
    };
    const run = async () => {
      running = true;
      const buffered = new Set(store.get(tracesAtom).map((trace) => trace.traceId));
      for (const id of pending.keys()) if (!buffered.has(id)) pending.delete(id);
      const batch = new Map([...pending].slice(0, 1000));
      try {
        if (batch.size) {
          const result = await gqlClient.request(MatchingTraceIdsQuery, {
            traceIds: [...batch.keys()],
            ...eventWindowBounds(window),
            search,
          });
          if (disposed) return;
          retryDelay = 500;
          const matched = new Set(result.matchingTraceIds);
          store.set(serverMatchedTraceIdsAtom, (previous) => {
            const next = new Set(previous);
            for (const [id, revision] of batch) {
              if (pending.get(id) !== revision) continue;
              pending.delete(id);
              if (matched.has(id)) next.add(id);
              else next.delete(id);
            }
            return next;
          });
        }
      } catch {
        // Back off while keeping pending IDs for a later retry.
        retryDelay = Math.min(retryDelay * 2, 10000);
      } finally {
        running = false;
        schedule();
      }
    };
    const unsubscribe = store.sub(liveTraceBatchAtom, () => {
      const batch = store.get(liveTraceBatchAtom);
      for (const trace of batch) pending.set(trace.traceId, ++version);
      schedule();
    });
    return () => {
      disposed = true;
      unsubscribe();
      clearTimeout(timer);
    };
  }, [store, key, search]);
}
