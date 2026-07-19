import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { renderHook, act } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { useWebSocket } from "./use-websocket";
import { tracesAtom, metricsAtom, logsAtom, newLogCountAtom } from "@/stores/telemetry";
import { makeTrace, makeMetric, makeLog } from "@/test/factories";
import type { Subscriber } from "@/lib/websocket-manager";

// wsManager owns the actual socket lifecycle (lib/websocket-manager.test.ts
// covers that in isolation); this hook only needs a fake subscribe() that
// hands back a captured Subscriber so tests can drive onMessage/onStatus
// directly, the same seam the real manager exposes.
const { subscribeMock } = vi.hoisted(() => ({ subscribeMock: vi.fn() }));
vi.mock("@/lib/websocket-manager", () => ({
  wsManager: { subscribe: subscribeMock },
}));

let capturedSubscriber: Subscriber | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  capturedSubscriber = null;
  subscribeMock.mockReset();
  subscribeMock.mockImplementation((subscriber: Subscriber) => {
    capturedSubscriber = subscriber;
    return vi.fn();
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function renderWithStore() {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(() => useWebSocket(), { wrapper });
  return { store, ...view };
}

describe("useWebSocket batching", () => {
  it("does not write to the store synchronously on message arrival", () => {
    const { store } = renderWithStore();

    act(() => {
      capturedSubscriber!.onMessage({ type: "traces", data: makeTrace({ traceId: "t1" }) });
    });

    expect(store.get(tracesAtom)).toEqual([]);
  });

  it("flushes queued messages as a single batched store update after the flush window", () => {
    const { store } = renderWithStore();

    act(() => {
      capturedSubscriber!.onMessage({ type: "traces", data: makeTrace({ traceId: "t1" }) });
      capturedSubscriber!.onMessage({ type: "traces", data: makeTrace({ traceId: "t2" }) });
    });
    expect(store.get(tracesAtom)).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(
      store
        .get(tracesAtom)
        .map((t) => t.traceId)
        .sort(),
    ).toEqual(["t1", "t2"]);
  });

  it("preserves arrival order across interleaved message types within one flush", () => {
    const { store } = renderWithStore();

    act(() => {
      capturedSubscriber!.onMessage({ type: "logs", data: makeLog({ id: "a" }) });
      capturedSubscriber!.onMessage({ type: "logs", data: makeLog({ id: "b" }) });
      capturedSubscriber!.onMessage({ type: "traces", data: makeTrace({ traceId: "t1" }) });
      capturedSubscriber!.onMessage({ type: "logs", data: makeLog({ id: "c" }) });
      vi.advanceTimersByTime(50);
    });

    // Logs prepend newest-first: within the contiguous [a, b] run "b" ends up
    // first; "c" arrived in a later run (after the trace message) so it
    // prepends on top of that.
    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["c", "b", "a"]);
    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["t1"]);
  });

  it("applies a trace add immediately followed by its delete in the same flush, in order", () => {
    const { store } = renderWithStore();
    store.set(tracesAtom, [makeTrace({ traceId: "t1" })]);

    act(() => {
      capturedSubscriber!.onMessage({ type: "traces", data: makeTrace({ traceId: "t2" }) });
      capturedSubscriber!.onMessage({ type: "trace-deletes", data: { traceId: "t2" } });
      vi.advanceTimersByTime(50);
    });

    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["t1"]);
  });

  it("routes metrics deliveries through the batched path", () => {
    const { store } = renderWithStore();

    act(() => {
      capturedSubscriber!.onMessage({ type: "metrics", data: makeMetric({ name: "m1" }) });
      capturedSubscriber!.onMessage({ type: "metrics", data: makeMetric({ name: "m2" }) });
      vi.advanceTimersByTime(50);
    });

    expect(
      store
        .get(metricsAtom)
        .map((m) => m.name)
        .sort(),
    ).toEqual(["m1", "m2"]);
  });

  it("starts a fresh flush window for messages arriving after a flush", () => {
    const { store } = renderWithStore();

    act(() => {
      capturedSubscriber!.onMessage({ type: "logs", data: makeLog({ id: "a" }) });
      vi.advanceTimersByTime(50);
    });
    expect(store.get(newLogCountAtom)).toBe(1);

    act(() => {
      capturedSubscriber!.onMessage({ type: "logs", data: makeLog({ id: "b" }) });
      vi.advanceTimersByTime(50);
    });
    expect(store.get(newLogCountAtom)).toBe(2);
    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["b", "a"]);
  });

  it("clears the pending flush timer on unmount", () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = renderWithStore();

    act(() => {
      capturedSubscriber!.onMessage({ type: "traces", data: makeTrace({ traceId: "t1" }) });
    });

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
