import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { Temporal } from "temporal-polyfill";
import type { ReactNode } from "react";
import { useLogListPage } from "./use-log-list-page";
import { logsAtom } from "@/stores/telemetry";
import { makeLog } from "@/test/factories";
import type { LogsPageQuery, LogsPageQueryVariables } from "@/gql/graphql";
import type { ChartTimeRange } from "@/lib/chart-time-range";

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn<(doc: unknown, vars: LogsPageQueryVariables) => Promise<LogsPageQuery>>(),
}));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

beforeEach(() => {
  requestMock.mockReset();
});

function queryLog(id: string) {
  return makeLog({ id });
}

function renderWithStore(range: ChartTimeRange, search = "") {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(
    ({ range: r, search: s }) => useLogListPage({ mode: "live", range: r }, s),
    {
      wrapper,
      initialProps: { range, search },
    },
  );
  return { store, ...view };
}

describe("useLogListPage", () => {
  it("checks for an older retained log when page 1 has no next page", async () => {
    requestMock.mockResolvedValueOnce({
      logs: { items: [queryLog("recent")], hasNextPage: false, endCursor: "recent-cursor" },
    });
    requestMock.mockResolvedValueOnce({
      logs: { items: [], hasNextPage: false, endCursor: null },
    });
    const before = Temporal.Now.instant();

    const { result } = renderWithStore("15m");

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    const vars = requestMock.mock.calls[0]?.[1];
    expect(vars?.after).toBeNull();
    expect(vars?.limit).toBe(100);
    const fromInstant = Temporal.Instant.from(vars!.from!);
    const deltaMs = before.since(fromInstant).total("milliseconds");
    expect(deltaMs).toBeGreaterThan(14.9 * 60_000);
    expect(deltaMs).toBeLessThan(15.1 * 60_000);
    expect(requestMock.mock.calls[1]?.[1]).toMatchObject({
      from: undefined,
      to: vars?.from,
      after: null,
      limit: 1,
    });
    expect(result.current.hasMore).toBe(false);
  });

  it("omits `from` for the all range", async () => {
    requestMock.mockResolvedValue({ logs: { items: [], hasNextPage: false, endCursor: null } });

    renderWithStore("all");

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0]?.[1]?.from).toBeUndefined();
  });

  it("replaces logsAtom with page 1 and reports whether another page exists", async () => {
    requestMock.mockResolvedValue({
      logs: { items: [queryLog("a"), queryLog("b")], hasNextPage: true, endCursor: "cursor-1" },
    });

    const { store, result } = renderWithStore("1h");

    await waitFor(() => expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a", "b"]));
    expect(result.current.hasMore).toBe(true);
  });

  it("loads the next page from the returned cursor and appends, deduping against what's already there", async () => {
    requestMock.mockResolvedValueOnce({
      logs: { items: [queryLog("a"), queryLog("b")], hasNextPage: true, endCursor: "cursor-1" },
    });
    const { store, result } = renderWithStore("1h");
    await waitFor(() => expect(store.get(logsAtom)).toHaveLength(2));

    requestMock.mockResolvedValueOnce({
      logs: { items: [queryLog("c"), queryLog("d")], hasNextPage: false, endCursor: null },
    });
    act(() => result.current.loadMore());

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    const secondVars = requestMock.mock.calls[1]?.[1];
    expect(secondVars?.after).toBe("cursor-1");
    expect(secondVars?.from).toBeUndefined();
    await waitFor(() => expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a", "b", "c", "d"]));
    expect(result.current.hasMore).toBe(false);
  });

  it("can load the next older page when the selected window is empty", async () => {
    requestMock.mockResolvedValueOnce({
      logs: { items: [], hasNextPage: false, endCursor: null },
    });
    requestMock.mockResolvedValueOnce({
      logs: { items: [queryLog("probe")], hasNextPage: false, endCursor: null },
    });
    const { store, result } = renderWithStore("1m");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    const firstFrom = requestMock.mock.calls[0]?.[1]?.from;
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    requestMock.mockResolvedValueOnce({
      logs: { items: [queryLog("older")], hasNextPage: false, endCursor: null },
    });
    act(() => result.current.loadMore());

    await waitFor(() => expect(store.get(logsAtom).map((log) => log.id)).toEqual(["older"]));
    const loadMoreVars = requestMock.mock.calls[2]?.[1];
    expect(loadMoreVars?.from).toBeUndefined();
    expect(loadMoreVars?.to).toBe(firstFrom);
    expect(loadMoreVars?.after).toBeNull();
    expect(result.current.hasMore).toBe(false);
  });

  it("does not invent an older page for the unbounded all range", async () => {
    requestMock.mockResolvedValue({ logs: { items: [], hasNextPage: false, endCursor: null } });

    const { result } = renderWithStore("all");

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(result.current.hasMore).toBe(false);
  });

  it("resets pagination and refetches page 1 on a range change, keeping the previous page visible while in flight", async () => {
    requestMock.mockResolvedValueOnce({
      logs: { items: [queryLog("a")], hasNextPage: true, endCursor: "cursor-1" },
    });
    const { store, rerender } = renderWithStore("1h");
    await waitFor(() => expect(store.get(logsAtom)).toHaveLength(1));

    let resolveSecond: (v: LogsPageQuery) => void = () => {};
    const pending = new Promise<LogsPageQuery>((resolve) => {
      resolveSecond = resolve;
    });
    requestMock.mockReturnValueOnce(pending);

    rerender({ range: "24h", search: "" });

    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a"]);

    resolveSecond({
      logs: { items: [queryLog("b"), queryLog("c")], hasNextPage: true, endCursor: "cursor-1" },
    });
    await waitFor(() => expect(store.get(logsAtom).map((l) => l.id)).toEqual(["b", "c"]));

    const nextPageVars = requestMock.mock.calls[1]?.[1];
    expect(nextPageVars?.after).toBeNull();
  });

  it("passes search through to the query", async () => {
    requestMock.mockResolvedValue({ logs: { items: [], hasNextPage: false, endCursor: null } });

    renderWithStore("1h", "timeout");

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0]?.[1]?.search).toBe("timeout");
    expect(requestMock.mock.calls[0]?.[1]?.from).toBeUndefined();
    expect(requestMock.mock.calls[0]?.[1]?.to).toBeUndefined();
  });

  it("does not restart an active retained-history search when the browsing range changes", async () => {
    requestMock.mockResolvedValue({ logs: { items: [], hasNextPage: false, endCursor: null } });

    const { rerender } = renderWithStore("1m", "timeout");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    rerender({ range: "24h", search: "timeout" });
    await act(async () => Promise.resolve());

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("queries a trace filter over retained history and composes it with search", async () => {
    requestMock.mockResolvedValue({ logs: { items: [], hasNextPage: false, endCursor: null } });
    const store = createStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    renderHook(() => useLogListPage({ mode: "live", range: "1m" }, "timeout", "trace-a"), {
      wrapper,
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0]?.[1]).toMatchObject({
      from: undefined,
      to: undefined,
      search: "timeout",
      traceId: "trace-a",
    });
  });

  it("resets pagination and refetches page 1 on a search change, keeping the previous page visible while in flight", async () => {
    requestMock.mockResolvedValueOnce({
      logs: { items: [queryLog("a")], hasNextPage: true, endCursor: "cursor-1" },
    });
    const { store, rerender } = renderWithStore("1h", "");
    await waitFor(() => expect(store.get(logsAtom)).toHaveLength(1));

    let resolveSecond: (v: LogsPageQuery) => void = () => {};
    const pending = new Promise<LogsPageQuery>((resolve) => {
      resolveSecond = resolve;
    });
    requestMock.mockReturnValueOnce(pending);

    rerender({ range: "1h", search: "timeout" });

    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a"]);

    resolveSecond({ logs: { items: [queryLog("b")], hasNextPage: false, endCursor: null } });
    await waitFor(() => expect(store.get(logsAtom).map((l) => l.id)).toEqual(["b"]));

    const secondVars = requestMock.mock.calls[1]?.[1];
    expect(secondVars?.after).toBeNull();
    expect(secondVars?.search).toBe("timeout");
  });

  it("loadMore reuses the search active when the page-1 fetch ran", async () => {
    requestMock.mockResolvedValueOnce({
      logs: { items: [queryLog("a")], hasNextPage: true, endCursor: "cursor-1" },
    });
    const { result } = renderWithStore("1h", "timeout");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    requestMock.mockResolvedValueOnce({
      logs: { items: [queryLog("b")], hasNextPage: false, endCursor: null },
    });
    act(() => result.current.loadMore());

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1]?.[1]?.search).toBe("timeout");
    expect(requestMock.mock.calls[1]?.[1]?.from).toBeUndefined();
    expect(requestMock.mock.calls[1]?.[1]?.to).toBeUndefined();
  });

  it("returns to the current browsing window when search is cleared", async () => {
    requestMock.mockResolvedValue({ logs: { items: [], hasNextPage: false, endCursor: null } });
    const { rerender } = renderWithStore("5m", "timeout");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    rerender({ range: "5m", search: "" });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(3));

    expect(requestMock.mock.calls[1]?.[1]?.from).toBeDefined();
    expect(requestMock.mock.calls[1]?.[1]?.to).toBeDefined();
    expect(requestMock.mock.calls[1]?.[1]?.search).toBe("");
  });
});
