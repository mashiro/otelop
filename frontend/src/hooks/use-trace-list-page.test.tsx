import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { Temporal } from "temporal-polyfill";
import type { ReactNode } from "react";
import { useTraceListPage } from "./use-trace-list-page";
import { tracesAtom } from "@/stores/telemetry";
import { makeTrace } from "@/test/factories";
import type { TracesPageQuery, TracesPageQueryVariables } from "@/gql/graphql";
import type { ChartTimeRange } from "@/lib/chart-time-range";

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn<(doc: unknown, vars: TracesPageQueryVariables) => Promise<TracesPageQuery>>(),
}));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

beforeEach(() => {
  requestMock.mockReset();
});

function queryTrace(traceId: string) {
  const t = makeTrace({ traceId });
  const rootSpan = t.spans[0]!;
  return {
    traceId: t.traceId,
    serviceName: t.serviceName,
    spanCount: t.spanCount,
    startTime: t.startTime,
    durationMs: t.duration / 1_000_000,
    rootSpan: {
      name: rootSpan.name,
      kind: rootSpan.kind,
      statusCode: rootSpan.statusCode,
      durationMs: rootSpan.duration / 1_000_000,
    },
  };
}

function renderWithStore(range: ChartTimeRange) {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(({ range: r }) => useTraceListPage(r), {
    wrapper,
    initialProps: { range },
  });
  return { store, ...view };
}

describe("useTraceListPage", () => {
  it("fetches page 1 with offset 0 / limit 100 and a range-derived `from`", async () => {
    requestMock.mockResolvedValue({ traces: { items: [], total: 0 } });
    const before = Temporal.Now.instant();

    renderWithStore("5m");

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const vars = requestMock.mock.calls[0]?.[1];
    expect(vars?.offset).toBe(0);
    expect(vars?.limit).toBe(100);
    const fromInstant = Temporal.Instant.from(vars!.from!);
    const deltaMs = before.since(fromInstant).total("milliseconds");
    expect(deltaMs).toBeGreaterThan(4.9 * 60_000);
    expect(deltaMs).toBeLessThan(5.1 * 60_000);
  });

  it("omits `from` for the all range", async () => {
    requestMock.mockResolvedValue({ traces: { items: [], total: 0 } });

    renderWithStore("all");

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0]?.[1]?.from).toBeUndefined();
  });

  it("replaces tracesAtom with page 1 and reports the connection total", async () => {
    requestMock.mockResolvedValue({
      traces: { items: [queryTrace("a"), queryTrace("b")], total: 250 },
    });

    const { store, result } = renderWithStore("1h");

    await waitFor(() => expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["a", "b"]));
    expect(result.current.total).toBe(250);
    expect(result.current.loaded).toBe(2);
    expect(result.current.hasMore).toBe(true);
  });

  it("loads the next page at offset=loaded and appends, deduping against what's already there", async () => {
    requestMock.mockResolvedValueOnce({
      traces: { items: [queryTrace("a"), queryTrace("b")], total: 4 },
    });
    const { store, result } = renderWithStore("1h");
    await waitFor(() => expect(store.get(tracesAtom)).toHaveLength(2));

    requestMock.mockResolvedValueOnce({
      traces: { items: [queryTrace("c"), queryTrace("d")], total: 4 },
    });
    act(() => result.current.loadMore());

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    const secondVars = requestMock.mock.calls[1]?.[1];
    expect(secondVars?.offset).toBe(2);
    expect(secondVars?.limit).toBe(100);
    await waitFor(() =>
      expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["a", "b", "c", "d"]),
    );
    expect(result.current.loaded).toBe(4);
    expect(result.current.hasMore).toBe(false);
  });

  it("reuses the same `from` bound across load-more calls within one range", async () => {
    requestMock.mockResolvedValue({ traces: { items: [queryTrace("a")], total: 10 } });
    const { result } = renderWithStore("1h");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const firstFrom = requestMock.mock.calls[0]?.[1]?.from;

    act(() => result.current.loadMore());
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1]?.[1]?.from).toBe(firstFrom);
  });

  it("resets pagination and refetches page 1 on a range change, keeping the previous page visible while in flight", async () => {
    requestMock.mockResolvedValueOnce({ traces: { items: [queryTrace("a")], total: 1 } });
    const { store, rerender } = renderWithStore("1h");
    await waitFor(() => expect(store.get(tracesAtom)).toHaveLength(1));

    let resolveSecond: (v: TracesPageQuery) => void = () => {};
    const pending = new Promise<TracesPageQuery>((resolve) => {
      resolveSecond = resolve;
    });
    requestMock.mockReturnValueOnce(pending);

    rerender({ range: "6h" });

    // Still showing the 1h page while the 6h range's page 1 is in flight.
    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["a"]);

    resolveSecond({ traces: { items: [queryTrace("b"), queryTrace("c")], total: 50 } });
    await waitFor(() => expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["b", "c"]));

    const secondVars = requestMock.mock.calls[1]?.[1];
    expect(secondVars?.offset).toBe(0);
  });

  it("keeps showing the previous page when a range-change fetch rejects", async () => {
    requestMock.mockResolvedValueOnce({ traces: { items: [queryTrace("a")], total: 1 } });
    const { store, rerender } = renderWithStore("1h");
    await waitFor(() => expect(store.get(tracesAtom)).toHaveLength(1));

    requestMock.mockRejectedValueOnce(new Error("network error"));
    rerender({ range: "6h" });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["a"]);
  });
});
