import { describe, it, expect, afterEach, beforeEach, vi } from "vite-plus/test";
import type { ReactNode } from "react";
import { getDefaultStore } from "jotai";
import { render, screen, cleanup, act, within, waitFor } from "@testing-library/react";
import { LogList } from "./log-list";
import {
  logsAtom,
  selectedLogAtom,
  renderWindowMaxAtom,
  addLogAtom,
  logListWindowAtom,
} from "@/stores/telemetry";
import { logSearchAtom } from "@/stores/filters";
import { makeLog } from "@/test/factories";
import { LIST_DISPLAY_CAP } from "@/lib/list-render-cap";
import { SIGNAL_PAGE_SIZE } from "@/hooks/use-signal-list-page";
import type { LogsPageQuery, LogsPageQueryVariables } from "@/gql/graphql";

// Base UI's ScrollArea calls Element.getAnimations(), which happy-dom (this
// project's test environment) doesn't implement — see the identical mock in
// metric-list.test.tsx.
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn<(doc: unknown, vars: LogsPageQueryVariables) => Promise<LogsPageQuery>>(),
}));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

// A leaf every row renders (the severity Pill) whose render count doubles as
// a proxy for "how many rows actually re-rendered" — this guards the
// React Compiler's row-level bail-out (LogRow is a plain function; no
// React.memo involved).
const { pillRenders } = vi.hoisted(() => ({ pillRenders: { current: 0 } }));
vi.mock("@/components/common/pill", () => ({
  Pill: ({ children }: { children: ReactNode }) => {
    pillRenders.current++;
    return <span>{children}</span>;
  },
}));

beforeEach(() => {
  const store = getDefaultStore();
  store.set(logsAtom, []);
  store.set(logSearchAtom, "");
  store.set(selectedLogAtom, null);
  store.set(renderWindowMaxAtom, LIST_DISPLAY_CAP);
  requestMock.mockReset();
  requestMock.mockResolvedValue({ logs: { items: [], hasNextPage: false, endCursor: null } });
  pillRenders.current = 0;
});
afterEach(cleanup);

function makeLogs(count: number, idPrefix = "log") {
  return Array.from({ length: count }, (_, i) =>
    makeLog({
      id: `${idPrefix}-${i}`,
      // Unique per row (unlike makeLog()'s default "request handled") so
      // individual rows are queryable by body text below.
      body: `${idPrefix}-${i}`,
      timestamp: `2024-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
    }),
  );
}

// Wire-shaped items (LogsPageQuery's item selection) for driving requestMock
// directly, as opposed to makeLogs()'s domain-shaped LogData for presetting
// logsAtom.
function makeQueryLogs(count: number, idPrefix = "q-log"): LogsPageQuery["logs"]["items"] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${idPrefix}-${i}`,
    timestamp: `2024-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
    observedTimestamp: `2024-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
    traceId: "",
    spanId: "",
    severityNumber: 9,
    severityText: "INFO",
    body: "log body",
    serviceName: "checkout",
    attributes: {},
    resource: {},
  }));
}

describe("LogList row rendering", () => {
  it("renders one row per log when under the display cap", () => {
    const store = getDefaultStore();
    store.set(logsAtom, makeLogs(3));

    render(<LogList />);

    const rows = screen.getAllByRole("row");
    // +1 for the header row.
    expect(rows).toHaveLength(4);
  });

  it("caps rendered rows at LIST_DISPLAY_CAP on initial mount", () => {
    const store = getDefaultStore();
    const total = LIST_DISPLAY_CAP + 20;
    store.set(logsAtom, makeLogs(total));

    render(<LogList />);

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(LIST_DISPLAY_CAP + 1); // + header row
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });

  it("does not show Load more when loaded rows are within the cap and there's no next page", () => {
    const store = getDefaultStore();
    store.set(logsAtom, makeLogs(LIST_DISPLAY_CAP));

    render(<LogList />);

    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("does not re-render every row when an unrelated store update produces a new array of the same log objects (React Compiler bail-out)", () => {
    const store = getDefaultStore();
    store.set(logsAtom, makeLogs(5));

    render(<LogList />);
    const rendersAfterMount = pillRenders.current;
    expect(rendersAfterMount).toBe(5);

    // Same log objects, new outer array reference — simulates a derived-atom
    // recompute that doesn't actually touch any individual row's data.
    act(() => {
      store.set(logsAtom, (prev) => [...prev]);
    });

    expect(pillRenders.current).toBe(rendersAfterMount);
  });

  it("re-renders only the affected rows when a single log's selection state changes", () => {
    const store = getDefaultStore();
    const logs = makeLogs(5);
    store.set(logsAtom, logs);

    render(<LogList />);
    const rendersAfterMount = pillRenders.current;

    act(() => {
      store.set(selectedLogAtom, logs[2]);
    });

    // Selecting a log swaps in the detail pane (which renders its own Pill)
    // on top of re-rendering that one list row — bounded, not a full
    // re-render of all 5 rows' Pills.
    expect(pillRenders.current).toBeLessThan(rendersAfterMount + 5);
  });

  it("still renders correctly after a log is updated (its row reflects the new data)", () => {
    const store = getDefaultStore();
    store.set(logsAtom, [makeLog({ id: "log-0", body: "first" })]);

    render(<LogList />);
    expect(screen.getByText("first")).toBeTruthy();

    act(() => {
      store.set(logsAtom, [makeLog({ id: "log-0", body: "updated" })]);
    });

    expect(screen.queryByText("first")).toBeNull();
    expect(screen.getByText("updated")).toBeTruthy();
  });

  it("shows the Trace ID link only for logs with a non-zero traceId", () => {
    const store = getDefaultStore();
    store.set(logsAtom, [
      makeLog({ id: "with-trace", traceId: "abc123def456" }),
      makeLog({ id: "no-trace", traceId: "" }),
    ]);

    render(<LogList />);

    const rows = screen.getAllByRole("row").slice(1); // drop header
    expect(within(rows[0]).queryByTitle("View trace")).toBeTruthy();
    expect(within(rows[1]).queryByTitle("View trace")).toBeNull();
  });
});

// addLogAtom prepends (no re-sort — see stores/telemetry.ts), so the body
// text doubles as a stable per-row identifier across live inserts.
function makeLiveLog(id: string) {
  return makeLog({ id, body: id });
}

function seedLiveLogs(store: ReturnType<typeof getDefaultStore>, ids: string[]) {
  for (const id of ids) {
    store.set(addLogAtom, makeLiveLog(id));
  }
}

describe("LogList render window (bounded sliding)", () => {
  it("slides onto already-loaded rows without fetching when Load more is clicked", () => {
    const store = getDefaultStore();
    const total = LIST_DISPLAY_CAP + SIGNAL_PAGE_SIZE + 50;
    store.set(logsAtom, makeLogs(total));

    render(<LogList />);
    const callsAfterMount = requestMock.mock.calls.length;
    expect(screen.getByText("log-0")).toBeTruthy();

    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });

    expect(screen.getAllByRole("row")).toHaveLength(LIST_DISPLAY_CAP + 1);
    expect(screen.queryByText("log-0")).toBeNull();
    expect(screen.getByText(`log-${SIGNAL_PAGE_SIZE}`)).toBeTruthy();
    expect(requestMock.mock.calls.length).toBe(callsAfterMount);
  });

  it("falls through to fetching another page once loaded rows run out, then slides onto it", async () => {
    const store = getDefaultStore();
    requestMock.mockResolvedValueOnce({
      logs: { items: makeQueryLogs(LIST_DISPLAY_CAP), hasNextPage: true, endCursor: "cursor-1" },
    });
    requestMock.mockResolvedValueOnce({
      logs: {
        items: makeQueryLogs(SIGNAL_PAGE_SIZE, "older-log"),
        hasNextPage: false,
        endCursor: null,
      },
    });

    render(<LogList />);
    await waitFor(() => expect(store.get(logsAtom)).toHaveLength(LIST_DISPLAY_CAP));

    const button = await screen.findByRole("button", { name: "Load more" });
    await act(async () => {
      button.click();
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1]?.[1]).toMatchObject({ after: "cursor-1" });
    await waitFor(() =>
      expect(store.get(logsAtom)).toHaveLength(LIST_DISPLAY_CAP + SIGNAL_PAGE_SIZE),
    );
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(LIST_DISPLAY_CAP + 1));
  });

  it("resets the render window to the head when the search changes", () => {
    const store = getDefaultStore();
    store.set(logsAtom, makeLogs(LIST_DISPLAY_CAP + SIGNAL_PAGE_SIZE + 50));

    render(<LogList />);
    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    expect(screen.queryByText("log-0")).toBeNull();

    // Every preset log shares makeLog()'s default serviceName ("frontend"),
    // so matching on it keeps the filtered list populated purely
    // client-side — no need to wait on the search request.
    act(() => {
      store.set(logSearchAtom, "frontend");
    });

    expect(screen.getByText("log-0")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(LIST_DISPLAY_CAP + 1);
  });

  it("stays at the head as live rows arrive, letting the oldest visible row fall out of the window", () => {
    const store = getDefaultStore();
    store.set(logListWindowAtom, { mode: "live", range: "all" });
    store.set(renderWindowMaxAtom, 3);
    seedLiveLogs(store, ["a", "b", "c"]);

    render(<LogList />);
    expect(screen.getByText("c")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
    expect(screen.getByText("a")).toBeTruthy();

    act(() => {
      store.set(addLogAtom, makeLiveLog("d"));
    });

    expect(screen.getByText("d")).toBeTruthy();
    expect(screen.getByText("c")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
    expect(screen.queryByText("a")).toBeNull();
  });

  it("keeps the visible rows stable when a live row arrives while scrolled into history, growing the newer count instead of shifting content", () => {
    const store = getDefaultStore();
    store.set(logListWindowAtom, { mode: "live", range: "all" });
    store.set(renderWindowMaxAtom, 2);
    seedLiveLogs(store, ["a", "b", "c", "d", "e"]);

    render(<LogList />);
    expect(screen.getByText("e")).toBeTruthy();
    expect(screen.getByText("d")).toBeTruthy();

    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    expect(screen.getByText("b")).toBeTruthy();
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByRole("button", { name: /3 newer/ })).toBeTruthy();

    act(() => {
      store.set(addLogAtom, makeLiveLog("f"));
    });

    expect(screen.getByText("b")).toBeTruthy();
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByRole("button", { name: /4 newer/ })).toBeTruthy();
  });

  it("returns to the head when 'back to latest' is clicked", () => {
    const store = getDefaultStore();
    store.set(logListWindowAtom, { mode: "live", range: "all" });
    store.set(renderWindowMaxAtom, 2);
    seedLiveLogs(store, ["a", "b", "c", "d", "e"]);

    render(<LogList />);
    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    expect(screen.getByText("b")).toBeTruthy();

    act(() => {
      screen.getByRole("button", { name: /newer — back to latest/ }).click();
    });

    expect(screen.getByText("e")).toBeTruthy();
    expect(screen.getByText("d")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /back to latest/ })).toBeNull();
  });
});
