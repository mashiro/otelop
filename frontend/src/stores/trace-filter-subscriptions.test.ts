import { createStore } from "jotai";
import { expect, it, vi } from "vite-plus/test";
import { createFilteredTracesAtom } from "./filters";
import {
  replaceTracePageAtom,
  tracesAtom,
  traceListWindowAtom,
  serverMatchedTraceIdsAtom,
} from "./telemetry";
import { makeTrace, makeSpan } from "@/test/factories";

it("does not publish identical filtered rows for excluded arrivals or unchanged match sets", () => {
  const store = createStore();
  store.set(traceListWindowAtom, { mode: "live", range: "all" });
  const kept = makeTrace({ traceId: "kept", serviceName: "checkout" });
  store.set(tracesAtom, [kept]);
  const filtered = createFilteredTracesAtom("checkout");
  const notify = vi.fn();
  const unsubscribe = store.sub(filtered, notify);
  const before = store.get(filtered);
  store.set(tracesAtom, [makeTrace({ traceId: "excluded", serviceName: "other" }), kept]);
  store.set(serverMatchedTraceIdsAtom, new Set(["kept"]));
  expect(store.get(filtered)).toBe(before);
  expect(notify).not.toHaveBeenCalled();
  store.set(tracesAtom, []);
  expect(store.get(filtered)).toEqual([]);
  expect(notify).toHaveBeenCalledOnce();
  unsubscribe();
});

it("reconciles refreshed summaries without discarding loaded spans or unchanged row references", () => {
  const store = createStore();
  const span = makeSpan();
  const trace = makeTrace({ spans: [span], spanCount: 1 });
  store.set(tracesAtom, [trace]);
  const refresh = (summary: typeof trace) =>
    store.set(replaceTracePageAtom, {
      items: [summary],
      idsBeforeRequest: new Set([trace.traceId]),
      window: { mode: "live", range: "all" },
    });
  refresh({ ...trace, spans: [], rootSpan: trace.rootSpan ? { ...trace.rootSpan } : undefined });
  expect(store.get(tracesAtom)[0]).toBe(trace);
  refresh({ ...trace, spans: [], spanCount: 2 });
  expect(store.get(tracesAtom)[0].spans).toBe(trace.spans);
  expect(store.get(tracesAtom)[0].spanCount).toBe(2);
  refresh({ ...trace, spans: [], spanCount: 0 });
  expect(store.get(tracesAtom)[0].spans).toBe(trace.spans);
});
