import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { renderHook, act } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { useWebSocket } from "./use-websocket";
import { tracesAtom, metricsAtom, logsAtom } from "@/stores/telemetry";
import { parseEpochNs } from "@/lib/normalize";
import { makeTrace } from "@/test/factories";

// vi.mock's factory is hoisted above every top-level statement in this file,
// so the mock socket/message-listener registry it needs must live inside
// vi.hoisted rather than as an outer const the factory closes over.
const { simulateMessage, listeners } = vi.hoisted(() => {
  const listeners: Array<(msg: unknown) => void> = [];
  return {
    listeners,
    simulateMessage: (msg: unknown) => {
      for (const listener of listeners) listener(msg);
    },
  };
});

// A fake WsManager whose subscribe() immediately reports "connected" and
// records the subscriber's onMessage — this test only exercises
// useWebSocket's normalize-then-dispatch behavior, not WsManager's own
// connect/reconnect lifecycle (see lib/websocket-manager.test.ts for that).
vi.mock("@/lib/websocket-manager", () => ({
  wsManager: {
    subscribe(subscriber: { onStatus: (s: string) => void; onMessage: (msg: unknown) => void }) {
      subscriber.onStatus("connected");
      listeners.push(subscriber.onMessage);
      return () => {
        const idx = listeners.indexOf(subscriber.onMessage);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  },
}));

function renderWithStore() {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(() => useWebSocket(), { wrapper });
  return { store, ...view };
}

// Wire-shaped (pre-normalize) fixtures — these tests exercise the hook's
// batching/throttle behavior, not normalize.ts, so only the fields normalize
// actually reads need real values.
function wireTrace(traceId: string) {
  return {
    traceId,
    serviceName: "frontend",
    spans: [],
    spanCount: 1,
    startTime: "2024-01-01T00:00:00Z",
    duration: 1_000_000,
  };
}

function wireLog(id: string) {
  return {
    id,
    timestamp: "2024-01-01T00:00:00Z",
    observedTimestamp: "2024-01-01T00:00:00Z",
    traceId: "",
    spanId: "",
    severityNumber: 9,
    severityText: "INFO",
    body: id,
    serviceName: "frontend",
    attributes: {},
    resource: {},
  };
}

function wireMetric(name: string) {
  return {
    name,
    description: "",
    unit: "",
    type: "Sum",
    serviceName: "frontend",
    resource: {},
    dataPoints: [],
    pointCount: 0,
    latestValue: null,
    receivedAt: "2024-01-01T00:00:00Z",
  };
}

// This hook is the single place a WS delivery (still wire-shaped: ISO
// timestamp strings, no epoch field — see types/telemetry.ts) gets
// normalized before entering the store (see lib/normalize.ts's doc comment
// on why every ingest entry point must route through it).
describe("useWebSocket", () => {
  it("normalizes a wire trace delivery into a view model with startEpochNs", () => {
    const { store } = renderWithStore();

    simulateMessage({
      type: "traces",
      data: {
        traceId: "t1",
        serviceName: "frontend",
        spans: [],
        spanCount: 1,
        startTime: "2024-01-01T00:00:00.123456789Z",
        duration: 1_000_000,
      },
    });

    const trace = store.get(tracesAtom)[0];
    expect(trace?.startEpochNs).toBe(parseEpochNs("2024-01-01T00:00:00.123456789Z"));
  });

  it("normalizes a wire metric delivery's data points into view models with epochNs", () => {
    const { store } = renderWithStore();

    simulateMessage({
      type: "metrics",
      data: {
        name: "http.requests",
        description: "",
        unit: "",
        type: "Sum",
        serviceName: "frontend",
        resource: {},
        dataPoints: [
          { id: "a", timestamp: "2024-01-01T00:00:00.500000000Z", value: 1, attributes: {} },
        ],
        pointCount: 1,
        latestValue: 1,
        receivedAt: "2024-01-01T00:00:00Z",
      },
    });

    const point = store.get(metricsAtom)[0]?.dataPoints[0];
    expect(point?.epochNs).toBe(parseEpochNs("2024-01-01T00:00:00.500000000Z"));
  });

  it("normalizes a wire log delivery into a view model with epochNs", () => {
    const { store } = renderWithStore();

    simulateMessage({
      type: "logs",
      data: {
        id: "log-1",
        timestamp: "2024-01-01T00:00:00.777777777Z",
        observedTimestamp: "2024-01-01T00:00:00.777777777Z",
        traceId: "",
        spanId: "",
        severityNumber: 9,
        severityText: "INFO",
        body: "hello",
        serviceName: "frontend",
        attributes: {},
        resource: {},
      },
    });

    const log = store.get(logsAtom)[0];
    expect(log?.epochNs).toBe(parseEpochNs("2024-01-01T00:00:00.777777777Z"));
  });
});

// The hook applies a leading-edge + trailing throttle around the batch
// atoms (stores/telemetry.ts's addTracesAtom/addMetricsAtom/addLogsAtom): an
// idle tab's first message is applied synchronously (no added latency for a
// sparse trickle), which also opens a 50ms window; anything that arrives
// while the window is open queues and flushes together, and the window
// keeps re-opening every 50ms as long as messages keep arriving, closing
// only once a tick finds nothing queued.
describe("useWebSocket batching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies the first message of an idle window synchronously, without waiting for a timer", () => {
    const { store } = renderWithStore();

    act(() => {
      simulateMessage({ type: "traces", data: wireTrace("t1") });
    });

    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["t1"]);
  });

  it("queues messages that arrive while the window is open and flushes them as one batched write", () => {
    const { store } = renderWithStore();
    let traceWrites = 0;
    store.sub(tracesAtom, () => {
      traceWrites++;
    });

    act(() => {
      simulateMessage({ type: "traces", data: wireTrace("t1") }); // leading — dispatched immediately
      simulateMessage({ type: "traces", data: wireTrace("t2") }); // queued
      simulateMessage({ type: "traces", data: wireTrace("t3") }); // queued
    });
    expect(traceWrites).toBe(1);
    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["t1"]);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    // t2 and t3 land in a single additional store write, not two.
    expect(traceWrites).toBe(2);
    expect(
      store
        .get(tracesAtom)
        .map((t) => t.traceId)
        .toSorted(),
    ).toEqual(["t1", "t2", "t3"]);
  });

  it("keeps flushing every 50ms while a stream is sustained, then closes the window once a tick is empty", () => {
    const { store } = renderWithStore();

    act(() => {
      simulateMessage({ type: "logs", data: wireLog("a") }); // leading
    });
    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a"]);

    act(() => {
      simulateMessage({ type: "logs", data: wireLog("b") }); // queued
      vi.advanceTimersByTime(50); // flushes "b", window stays open
    });
    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["b", "a"]);

    act(() => {
      simulateMessage({ type: "logs", data: wireLog("c") }); // queued
      vi.advanceTimersByTime(50); // flushes "c", window stays open
    });
    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["c", "b", "a"]);

    // Nothing arrives during this tick — the window closes.
    act(() => {
      vi.advanceTimersByTime(50);
    });

    // The next message arrives after the window closed, so it's leading
    // again: applied immediately, not held for another 50ms tick.
    act(() => {
      simulateMessage({ type: "logs", data: wireLog("d") });
    });
    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("routes metrics deliveries through the batched path", () => {
    const { store } = renderWithStore();

    act(() => {
      simulateMessage({ type: "metrics", data: wireMetric("m1") }); // leading
      simulateMessage({ type: "metrics", data: wireMetric("m2") }); // queued
      vi.advanceTimersByTime(50);
    });

    expect(
      store
        .get(metricsAtom)
        .map((m) => m.name)
        .toSorted(),
    ).toEqual(["m1", "m2"]);
  });

  it("preserves add -> delete -> add order for the same trace within one flush (a global group-by-type would get this wrong)", () => {
    const { store } = renderWithStore();

    act(() => {
      simulateMessage({ type: "traces", data: wireTrace("leading") }); // leading, opens the window
      simulateMessage({ type: "traces", data: wireTrace("t1") }); // queued run 1: traces
      simulateMessage({ type: "trace-deletes", data: { traceId: "t1" } }); // queued run 2: trace-deletes
      simulateMessage({ type: "traces", data: wireTrace("t1") }); // queued run 3: traces (re-added)
      vi.advanceTimersByTime(50);
    });

    // Splitting the queue only at type boundaries (not a global group-by)
    // keeps this arrival order: add, delete, add — so t1 ends up present.
    // A global group-by-type would batch both trace adds ahead of the
    // delete and lose t1.
    expect(
      store
        .get(tracesAtom)
        .map((t) => t.traceId)
        .toSorted(),
    ).toEqual(["leading", "t1"]);
  });

  it("preserves arrival order across interleaved message types within one flush", () => {
    const { store } = renderWithStore();

    act(() => {
      simulateMessage({ type: "logs", data: wireLog("leading") }); // leading
      simulateMessage({ type: "logs", data: wireLog("a") }); // queued run 1: logs
      simulateMessage({ type: "logs", data: wireLog("b") }); // queued run 1: logs
      simulateMessage({ type: "traces", data: wireTrace("t1") }); // queued run 2: traces
      simulateMessage({ type: "logs", data: wireLog("c") }); // queued run 3: logs
      vi.advanceTimersByTime(50);
    });

    // Logs prepend newest-first: within the contiguous [a, b] run "b" ends
    // up first; "c" arrived in a later run (after the trace message) so it
    // prepends on top of that.
    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["c", "b", "a", "leading"]);
    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["t1"]);
  });

  it("clears the pending flush timer on unmount and never flushes the still-queued messages", () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { store, unmount } = renderWithStore();

    act(() => {
      simulateMessage({ type: "logs", data: wireLog("a") }); // leading, opens the window
      simulateMessage({ type: "logs", data: wireLog("b") }); // queued, never flushed
    });

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a"]);
    clearTimeoutSpy.mockRestore();
  });
});

describe("useWebSocket batching — trace merge seeded before the hook mounts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a queued delete removes a trace that already existed before this flush window", () => {
    const { store } = renderWithStore();
    store.set(tracesAtom, [makeTrace({ traceId: "t1" })]);

    act(() => {
      simulateMessage({ type: "traces", data: wireTrace("t2") }); // leading
      simulateMessage({ type: "trace-deletes", data: { traceId: "t2" } }); // queued
      vi.advanceTimersByTime(50);
    });

    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["t1"]);
  });
});
