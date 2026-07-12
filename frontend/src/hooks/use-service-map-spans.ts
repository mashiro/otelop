import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { mergeManyTraceSpansAtom } from "@/stores/telemetry";
import { eventWindowBounds, eventWindowKey, type EventTimeWindow } from "@/lib/event-time-window";
import { toSpan } from "@/lib/span-mapping";

const ServiceMapSpansQuery = graphql(`
  query ServiceMapSpans($from: Time, $to: Time!) {
    traces(limit: 0, from: $from, to: $to) {
      items {
        traceId
        spans {
          ...SpanFields
        }
      }
    }
  }
`);

// lib/service-graph.ts (the service map's edge builder) walks every buffered
// trace's spans to derive parent/child service call edges — it genuinely
// needs full span data across every trace, not just the one the trace list
// shows, so it can't share use-trace-spans.ts's per-trace fetch. Fetching
// that up front for every trace is exactly the N+1 use-initial-load.ts's
// trimmed query now avoids; the trade-off here is deliberate: fetch it once
// per range, lazily, only when the service map view is actually opened
// (components/traces/service-map.tsx), rather than on every page load. This
// bulk query still resolves each trace's `spans` field server-side via one
// TraceByID SQL call per trace (see trace_resolver.go) — there is no bulk
// "spans for every trace" storage query today — so opening the map is a
// legitimately heavy one-off fetch, not a free one; scoping it to the
// trace tab's selected range (issue #160) at least keeps a 1h-windowed map
// from pulling the whole retention window's worth of traces.
export function useServiceMapSpans(active: boolean, window: EventTimeWindow): void {
  const mergeSpans = useSetAtom(mergeManyTraceSpansAtom);
  const windowKey = eventWindowKey(window);
  // Tracks the range this was last successfully fetched for (not just a
  // boolean) — set only once the fetch actually succeeds (not at dispatch
  // time) so StrictMode's mount->cleanup->mount cycle can't strand this
  // permanently unfetched: if it were set eagerly, the first (cancelled)
  // attempt would claim the guard before resolving, blocking the second,
  // uncancelled attempt that would have actually merged the data — see the
  // identical reasoning in use-trace-spans.ts. A range change invalidates
  // the guard so reopening the map with a wider/narrower window refetches.
  const fetchedForRangeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active || fetchedForRangeRef.current === windowKey) return;
    let ignore = false;
    const { from, to } = eventWindowBounds(window);
    const load = async () => {
      try {
        const data = await gqlClient.request(ServiceMapSpansQuery, { from, to });
        if (ignore) return;
        mergeSpans(
          data.traces.items.map((t) => ({
            traceId: t.traceId,
            spans: t.spans.map(toSpan),
          })),
        );
        fetchedForRangeRef.current = windowKey;
      } catch {
        // Leave the guard unset; the next activation retries.
      }
    };
    void load();

    return () => {
      ignore = true;
    };
  }, [active, windowKey, mergeSpans]);
}
