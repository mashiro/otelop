import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useInitialLoad } from "./use-initial-load";
import { tracesAtom, metricsAtom, logsAtom } from "@/stores/telemetry";
import { makeTrace, makeMetric, makeLog } from "@/test/factories";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

beforeEach(() => {
  requestMock.mockReset();
});

describe("useInitialLoad", () => {
  it("bootstraps traces, metrics, and logs from the initial-load query", async () => {
    const trace = makeTrace();
    requestMock.mockResolvedValue({
      traces: {
        items: [
          {
            traceId: trace.traceId,
            serviceName: trace.serviceName,
            spanCount: trace.spanCount,
            startTime: trace.startTime,
            durationMs: trace.duration / 1_000_000,
            spans: trace.spans.map((s) => ({ ...s, durationMs: s.duration / 1_000_000 })),
          },
        ],
      },
      metrics: { items: [makeMetric()] },
      logs: { items: [makeLog()] },
    });
    const store = createStore();

    renderHook(() => useInitialLoad(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => expect(store.get(tracesAtom)).toHaveLength(1));
    expect(store.get(metricsAtom)).toHaveLength(1);
    expect(store.get(logsAtom)).toHaveLength(1);
  });

  it("leaves the stores empty (not thrown) when the bootstrap fetch fails", async () => {
    requestMock.mockRejectedValue(new Error("network error"));
    const store = createStore();

    renderHook(() => useInitialLoad(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(store.get(tracesAtom)).toEqual([]);
  });
});
