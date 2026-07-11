import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { mergeTraceSpansAtom } from "@/stores/telemetry";
import { toSpan } from "@/lib/span-mapping";
import type { TraceData } from "@/types/telemetry";

const TraceSpansQuery = graphql(`
  query TraceSpans($traceId: ID!) {
    trace(traceId: $traceId) {
      spans {
        ...SpanFields
      }
    }
  }
`);

// Fetches one trace's full span data exactly once, the moment its detail
// view opens (components/traces/trace-detail.tsx) — the trace counterpart
// to use-metric-range-points.ts's on-demand server fetch. use-initial-load.ts
// deliberately keeps the trace list summary-only (spanCount/rootSpan, no
// `spans`) to avoid the N+1 self-telemetry surfaced (815 x Trace.spans ->
// 815 TraceByID SQL calls for one page load), so the waterfall/service map
// need this to backfill the actual span rows on demand.
export function useTraceSpans(trace: TraceData | null): void {
  const mergeSpans = useSetAtom(mergeTraceSpansAtom);

  useEffect(() => {
    if (!trace) return;
    // spanCount is the TracesPage summary's authoritative total; comparing
    // against it (rather than just spans.length > 0) means a trace whose
    // spans got fetched already skips the request entirely — including on
    // the re-render this effect's own successful merge causes, since that
    // produces a new `trace` object with spans populated.
    if (trace.spans.length >= trace.spanCount) return;

    // No StrictMode dedup guard here (unlike use-initial-load.ts's
    // loadedRef): the merge below writes into the shared jotai store, not
    // local component state, so a "second" mount's fetch merging the exact
    // same data is idempotent — no double-render bug to guard against. A ref
    // that persisted across renders to prevent that duplicate would instead
    // create a real bug: StrictMode's mount->cleanup->mount cancels the
    // first attempt (`ignore` below) before it resolves, and a persistent
    // guard would then block the second, uncancelled attempt from ever
    // firing — permanently starving this trace of spans.
    let ignore = false;
    const traceId = trace.traceId;
    const load = async () => {
      try {
        const data = await gqlClient.request(TraceSpansQuery, { traceId });
        if (ignore || !data.trace) return;
        mergeSpans({ traceId, spans: data.trace.spans.map(toSpan) });
      } catch {
        // Leave spans empty; the waterfall/detail view just renders nothing
        // extra rather than throwing. A retry happens if the trace detail
        // is closed and reopened (a fresh effect run re-checks the guard
        // above, which is still unmet since nothing merged).
      }
    };
    void load();

    return () => {
      ignore = true;
    };
  }, [trace, mergeSpans]);
}
