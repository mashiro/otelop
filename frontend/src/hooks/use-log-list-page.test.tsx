import { describe, it, expect, vi, beforeEach } from "vitest";
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

function renderWithStore(range: ChartTimeRange) {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(({ range: r }) => useLogListPage(r), {
    wrapper,
    initialProps: { range },
  });
  return { store, ...view };
}

describe("useLogListPage", () => {
  it("fetches page 1 with offset 0 / limit 100 and a range-derived `from`", async () => {
    requestMock.mockResolvedValue({ logs: { items: [], total: 0 } });
    const before = Temporal.Now.instant();

    renderWithStore("15m");

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const vars = requestMock.mock.calls[0]?.[1];
    expect(vars?.offset).toBe(0);
    expect(vars?.limit).toBe(100);
    const fromInstant = Temporal.Instant.from(vars!.from!);
    const deltaMs = before.since(fromInstant).total("milliseconds");
    expect(deltaMs).toBeGreaterThan(14.9 * 60_000);
    expect(deltaMs).toBeLessThan(15.1 * 60_000);
  });

  it("omits `from` for the all range", async () => {
    requestMock.mockResolvedValue({ logs: { items: [], total: 0 } });

    renderWithStore("all");

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0]?.[1]?.from).toBeUndefined();
  });

  it("replaces logsAtom with page 1 and reports the connection total", async () => {
    requestMock.mockResolvedValue({
      logs: { items: [queryLog("a"), queryLog("b")], total: 320 },
    });

    const { store, result } = renderWithStore("1h");

    await waitFor(() => expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a", "b"]));
    expect(result.current.total).toBe(320);
    expect(result.current.loaded).toBe(2);
    expect(result.current.hasMore).toBe(true);
  });

  it("loads the next page at offset=loaded and appends, deduping against what's already there", async () => {
    requestMock.mockResolvedValueOnce({
      logs: { items: [queryLog("a"), queryLog("b")], total: 4 },
    });
    const { store, result } = renderWithStore("1h");
    await waitFor(() => expect(store.get(logsAtom)).toHaveLength(2));

    requestMock.mockResolvedValueOnce({
      logs: { items: [queryLog("c"), queryLog("d")], total: 4 },
    });
    act(() => result.current.loadMore());

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    const secondVars = requestMock.mock.calls[1]?.[1];
    expect(secondVars?.offset).toBe(2);
    await waitFor(() => expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a", "b", "c", "d"]));
    expect(result.current.loaded).toBe(4);
    expect(result.current.hasMore).toBe(false);
  });

  it("resets pagination and refetches page 1 on a range change, keeping the previous page visible while in flight", async () => {
    requestMock.mockResolvedValueOnce({ logs: { items: [queryLog("a")], total: 1 } });
    const { store, rerender } = renderWithStore("1h");
    await waitFor(() => expect(store.get(logsAtom)).toHaveLength(1));

    let resolveSecond: (v: LogsPageQuery) => void = () => {};
    const pending = new Promise<LogsPageQuery>((resolve) => {
      resolveSecond = resolve;
    });
    requestMock.mockReturnValueOnce(pending);

    rerender({ range: "24h" });

    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a"]);

    resolveSecond({ logs: { items: [queryLog("b"), queryLog("c")], total: 50 } });
    await waitFor(() => expect(store.get(logsAtom).map((l) => l.id)).toEqual(["b", "c"]));

    const secondVars = requestMock.mock.calls[1]?.[1];
    expect(secondVars?.offset).toBe(0);
  });
});
