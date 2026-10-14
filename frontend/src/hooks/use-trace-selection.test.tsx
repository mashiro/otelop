import { act, renderHook } from "@testing-library/react";
import { createStore } from "jotai";
import { expect, it } from "vite-plus/test";
import { createTestRouter } from "@/test/router";
import { makeTrace, makeSpan } from "@/test/factories";
import { addTracesAtom, tracesAtom, removeTraceAtom, mergeSpans } from "@/stores/telemetry";
import { useTraceSelection } from "./use-signal-route";

it("does not render for unrelated deliveries but observes selected updates and removal", async () => {
  const store = createStore();
  const selected = makeTrace({ traceId: "selected", spanCount: 1, spans: [makeSpan()] });
  store.set(tracesAtom, [selected]);
  const { wrapper } = await createTestRouter("/traces/selected", store);
  let renders = 0;
  const { result } = renderHook(
    () => {
      renders++;
      return useTraceSelection();
    },
    { wrapper },
  );
  const initialRenders = renders;
  for (let i = 0; i < 5; i++) {
    act(() => store.set(addTracesAtom, [makeTrace({ traceId: `unrelated-${i}` })]));
  }
  expect(renders).toBe(initialRenders);
  act(() => store.set(addTracesAtom, [{ ...selected, spanCount: 2 }]));
  expect(result.current.trace?.spanCount).toBe(2);
  act(() => store.set(removeTraceAtom, "selected"));
  expect(result.current.trace).toBeNull();
});

it("preserves the span array when a delivery adds no spans", () => {
  const spans = [makeSpan({ spanId: "one" })];
  expect(mergeSpans(spans, [])).toBe(spans);
  expect(mergeSpans(spans, [makeSpan({ spanId: "one" })])).toBe(spans);
  expect(mergeSpans(spans, [makeSpan({ spanId: "two" })])).toHaveLength(2);
});

it("switches the subscription when navigation selects a different trace", async () => {
  const store = createStore();
  const first = makeTrace({ traceId: "first", spanCount: 1 });
  const second = makeTrace({ traceId: "second", spanCount: 1 });
  store.set(tracesAtom, [first, second]);
  const { router, wrapper } = await createTestRouter("/traces/first", store);
  let renders = 0;
  const { result } = renderHook(
    () => {
      renders++;
      return useTraceSelection();
    },
    { wrapper },
  );
  await act(async () => {
    await router.navigate({ to: "/traces/$traceId", params: { traceId: "second" } });
  });
  expect(result.current.trace).toBe(second);
  const afterNavigation = renders;
  act(() => store.set(addTracesAtom, [{ ...first, spanCount: 2 }]));
  expect(renders).toBe(afterNavigation);
  act(() => store.set(addTracesAtom, [{ ...second, spanCount: 3 }]));
  expect(result.current.trace?.spanCount).toBe(3);
});
