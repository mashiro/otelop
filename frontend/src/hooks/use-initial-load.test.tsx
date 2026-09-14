import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useInitialLoad } from "./use-initial-load";
import {
  metricsAtom,
  totalTraceCountAtom,
  totalMetricCountAtom,
  totalLogCountAtom,
  renderWindowMaxAtom,
} from "@/stores/telemetry";
import { makeMetric } from "@/test/factories";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

beforeEach(() => {
  requestMock.mockReset();
});

describe("useInitialLoad", () => {
  it("bootstraps metrics (with empty dataPoints — issue #162 stops fetching them) from the initial-load query", async () => {
    // Traces and logs no longer bootstrap here — they're paginated by range
    // from their own tabs (hooks/use-trace-list-page.ts,
    // hooks/use-log-list-page.ts); metrics stay an unbounded fetch, but the
    // list only needs pointCount/latestValue, not the full series (#162).
    requestMock.mockResolvedValue({
      config: { traceCount: 10, metricCount: 2, logCount: 20, renderWindowMax: 500 },
      metrics: {
        items: [
          {
            name: "http.requests",
            description: "",
            unit: "",
            type: "Sum",
            serviceName: "frontend",
            resource: {},
            receivedAt: "2024-01-01T00:00:00Z",
            pointCount: 42,
            latestValue: 7,
          },
        ],
      },
    });
    const store = createStore();

    renderHook(() => useInitialLoad(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => expect(store.get(metricsAtom)).toHaveLength(1));
    const metric = store.get(metricsAtom)[0];
    expect(metric.dataPoints).toEqual([]);
    expect(metric.pointCount).toBe(42);
    expect(metric.latestValue).toBe(7);
  });

  it("populates the server-reported totals atoms from config", async () => {
    requestMock.mockResolvedValue({
      config: { traceCount: 300, metricCount: 5, logCount: 300, renderWindowMax: 500 },
      metrics: { items: [makeMetric()] },
    });
    const store = createStore();

    renderHook(() => useInitialLoad(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => expect(store.get(totalTraceCountAtom)).toBe(300));
    expect(store.get(totalMetricCountAtom)).toBe(5);
    expect(store.get(totalLogCountAtom)).toBe(300);
  });

  it("seeds renderWindowMaxAtom from the operator-configured config.renderWindowMax", async () => {
    requestMock.mockResolvedValue({
      config: { traceCount: 0, metricCount: 0, logCount: 0, renderWindowMax: 250 },
      metrics: { items: [] },
    });
    const store = createStore();

    renderHook(() => useInitialLoad(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => expect(store.get(renderWindowMaxAtom)).toBe(250));
  });

  it("does not replay cached bootstrap data over live updates on remount", async () => {
    requestMock.mockResolvedValue({
      config: { traceCount: 1, metricCount: 1, logCount: 1, renderWindowMax: 500 },
      metrics: { items: [makeMetric({ latestValue: 1 })] },
    });
    const store = createStore();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const first = renderHook(() => useInitialLoad(), { wrapper });
    await waitFor(() => expect(store.get(metricsAtom)).toHaveLength(1));
    first.unmount();
    const live = [makeMetric({ latestValue: 9 })];
    store.set(metricsAtom, live);
    renderHook(() => useInitialLoad(), { wrapper });
    expect(store.get(metricsAtom)).toBe(live);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("leaves metrics/totals untouched (not thrown) when the bootstrap fetch fails", async () => {
    requestMock.mockRejectedValue(new Error("network error"));
    const store = createStore();

    renderHook(() => useInitialLoad(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(store.get(metricsAtom)).toEqual([]);
    expect(store.get(totalTraceCountAtom)).toBe(0);
  });
});
