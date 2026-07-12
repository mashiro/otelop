import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { Temporal } from "temporal-polyfill";
import type { ReactNode } from "react";
import { useTraceListPage } from "./use-trace-list-page";
import { addTraceAtom, tracesAtom, serverMatchedTraceIdsAtom } from "@/stores/telemetry";
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

function renderWithStore(range: ChartTimeRange, search = "") {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(
    ({ range: r, search: s }) => useTraceListPage({ mode: "live", range: r }, s),
    {
      wrapper,
      initialProps: { range, search },
    },
  );
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

  it("reuses the same `from` and `to` bounds across load-more calls within one range", async () => {
    requestMock.mockResolvedValue({ traces: { items: [queryTrace("a")], total: 10 } });
    const { result } = renderWithStore("1h");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const firstFrom = requestMock.mock.calls[0]?.[1]?.from;
    const firstTo = requestMock.mock.calls[0]?.[1]?.to;
    expect(firstTo).toBeDefined();

    act(() => result.current.loadMore());
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1]?.[1]?.from).toBe(firstFrom);
    expect(requestMock.mock.calls[1]?.[1]?.to).toBe(firstTo);
  });

  it("ignores a load-more response from a previous search session", async () => {
    requestMock.mockResolvedValueOnce({ traces: { items: [queryTrace("a")], total: 2 } });
    const { store, result, rerender } = renderWithStore("1h", "");
    await waitFor(() => expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["a"]));

    let resolveOldPage: (value: TracesPageQuery) => void = () => {};
    requestMock.mockReturnValueOnce(
      new Promise<TracesPageQuery>((resolve) => {
        resolveOldPage = resolve;
      }),
    );
    act(() => result.current.loadMore());
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));

    requestMock.mockResolvedValueOnce({ traces: { items: [queryTrace("c")], total: 1 } });
    rerender({ range: "1h", search: "new" });
    await waitFor(() => expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["c"]));

    resolveOldPage({ traces: { items: [queryTrace("b")], total: 2 } });
    await act(async () => Promise.resolve());
    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["c"]);
    expect(result.current.total).toBe(1);
    expect(result.current.loaded).toBe(1);
  });

  it("preserves a WebSocket row received while page 1 is in flight", async () => {
    let resolvePage: (value: TracesPageQuery) => void = () => {};
    requestMock.mockReturnValueOnce(
      new Promise<TracesPageQuery>((resolve) => {
        resolvePage = resolve;
      }),
    );
    const { store } = renderWithStore("1h");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    store.set(addTraceAtom, makeTrace({ traceId: "live" }));
    resolvePage({ traces: { items: [queryTrace("live"), queryTrace("page")], total: 2 } });

    await waitFor(() =>
      expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["live", "page"]),
    );
    expect(store.get(tracesAtom)[0]?.spans).not.toHaveLength(0);
    expect(store.get(serverMatchedTraceIdsAtom)).toEqual(new Set(["live", "page"]));
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

    rerender({ range: "6h", search: "" });

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
    rerender({ range: "6h", search: "" });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["a"]);
  });

  it("passes search through to the query", async () => {
    requestMock.mockResolvedValue({ traces: { items: [], total: 0 } });

    renderWithStore("1h", "checkout");

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0]?.[1]?.search).toBe("checkout");
  });

  it("resets pagination and refetches page 1 on a search change, keeping the previous page visible while in flight", async () => {
    requestMock.mockResolvedValueOnce({ traces: { items: [queryTrace("a")], total: 1 } });
    const { store, rerender } = renderWithStore("1h", "");
    await waitFor(() => expect(store.get(tracesAtom)).toHaveLength(1));

    let resolveSecond: (v: TracesPageQuery) => void = () => {};
    const pending = new Promise<TracesPageQuery>((resolve) => {
      resolveSecond = resolve;
    });
    requestMock.mockReturnValueOnce(pending);

    rerender({ range: "1h", search: "checkout" });

    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["a"]);

    resolveSecond({ traces: { items: [queryTrace("b")], total: 1 } });
    await waitFor(() => expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["b"]));

    const secondVars = requestMock.mock.calls[1]?.[1];
    expect(secondVars?.offset).toBe(0);
    expect(secondVars?.search).toBe("checkout");
  });

  it("loadMore reuses the search active when the page-1 fetch ran", async () => {
    requestMock.mockResolvedValueOnce({ traces: { items: [queryTrace("a")], total: 2 } });
    const { result } = renderWithStore("1h", "checkout");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    requestMock.mockResolvedValueOnce({ traces: { items: [queryTrace("b")], total: 2 } });
    act(() => result.current.loadMore());

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1]?.[1]?.search).toBe("checkout");
  });

  // The server-vouched id set (stores/telemetry.ts's
  // serverMatchedTraceIdsAtom, consumed by stores/filters.ts's display
  // filter): page 1 replaces it, "Load more" unions into it, and the next
  // fetch session (here: a search change) starts fresh so ids matched under
  // the previous search don't keep passing the filter.
  it("tracks server-returned ids per fetch session: page 1 replaces, loadMore unions, a search change resets", async () => {
    requestMock.mockResolvedValueOnce({ traces: { items: [queryTrace("a")], total: 2 } });
    const { store, result, rerender } = renderWithStore("1h", "");
    await waitFor(() => expect(store.get(serverMatchedTraceIdsAtom)).toEqual(new Set(["a"])));

    requestMock.mockResolvedValueOnce({ traces: { items: [queryTrace("b")], total: 2 } });
    act(() => result.current.loadMore());
    await waitFor(() => expect(store.get(serverMatchedTraceIdsAtom)).toEqual(new Set(["a", "b"])));

    requestMock.mockResolvedValueOnce({ traces: { items: [queryTrace("c")], total: 1 } });
    rerender({ range: "1h", search: "narrower" });
    await waitFor(() => expect(store.get(serverMatchedTraceIdsAtom)).toEqual(new Set(["c"])));
  });
});
