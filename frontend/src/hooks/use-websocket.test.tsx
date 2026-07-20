import { describe, it, expect, vi } from "vite-plus/test";
import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { useWebSocket } from "./use-websocket";
import { tracesAtom, metricsAtom, logsAtom } from "@/stores/telemetry";
import { parseEpochNs } from "@/lib/normalize";

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
  renderHook(() => useWebSocket(), { wrapper });
  return store;
}

// This hook is the single place a WS delivery (still wire-shaped: ISO
// timestamp strings, no epoch field — see types/telemetry.ts) gets
// normalized before entering the store (see lib/normalize.ts's doc comment
// on why every ingest entry point must route through it).
describe("useWebSocket", () => {
  it("normalizes a wire trace delivery into a view model with startEpochNs", () => {
    const store = renderWithStore();

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
    const store = renderWithStore();

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
    const store = renderWithStore();

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
