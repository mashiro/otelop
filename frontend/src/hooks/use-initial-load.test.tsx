import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useInitialLoad } from "./use-initial-load";
import { metricsAtom } from "@/stores/telemetry";
import { makeMetric } from "@/test/factories";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

beforeEach(() => {
  requestMock.mockReset();
});

describe("useInitialLoad", () => {
  it("bootstraps metrics from the initial-load query", async () => {
    // Traces and logs no longer bootstrap here — they're paginated by range
    // from their own tabs (hooks/use-trace-list-page.ts,
    // hooks/use-log-list-page.ts); metrics stay an unbounded fetch (#162 is
    // the follow-up to scope this one too).
    requestMock.mockResolvedValue({
      metrics: { items: [makeMetric()] },
    });
    const store = createStore();

    renderHook(() => useInitialLoad(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => expect(store.get(metricsAtom)).toHaveLength(1));
  });

  it("leaves metrics empty (not thrown) when the bootstrap fetch fails", async () => {
    requestMock.mockRejectedValue(new Error("network error"));
    const store = createStore();

    renderHook(() => useInitialLoad(), {
      wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(store.get(metricsAtom)).toEqual([]);
  });
});
