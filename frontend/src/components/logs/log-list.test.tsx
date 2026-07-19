import { describe, it, expect, afterEach, beforeEach, vi } from "vite-plus/test";
import type { ReactNode } from "react";
import { getDefaultStore } from "jotai";
import { render, screen, cleanup, act, within } from "@testing-library/react";
import { LogList } from "./log-list";
import { logsAtom, selectedLogAtom } from "@/stores/telemetry";
import { logSearchAtom } from "@/stores/filters";
import { makeLog } from "@/test/factories";
import { LIST_DISPLAY_CAP } from "@/lib/list-render-cap";
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
// a proxy for "how many rows actually re-rendered" — memoization is only
// meaningful if the wrapped Row bails out of re-rendering its own children.
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
  requestMock.mockReset();
  requestMock.mockResolvedValue({ logs: { items: [], hasNextPage: false, endCursor: null } });
  pillRenders.current = 0;
});
afterEach(cleanup);

function makeLogs(count: number) {
  return Array.from({ length: count }, (_, i) =>
    makeLog({ id: `log-${i}`, timestamp: `2024-01-01T00:${String(i % 60).padStart(2, "0")}:00Z` }),
  );
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

  it("caps rendered rows at LIST_DISPLAY_CAP and reports the hidden count", () => {
    const store = getDefaultStore();
    const total = LIST_DISPLAY_CAP + 20;
    store.set(logsAtom, makeLogs(total));

    render(<LogList />);

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(LIST_DISPLAY_CAP + 1); // + header row
    expect(screen.getByText(/\+20 more/)).toBeTruthy();
  });

  it("does not show the overflow notice when at or under the cap", () => {
    const store = getDefaultStore();
    store.set(logsAtom, makeLogs(LIST_DISPLAY_CAP));

    render(<LogList />);

    expect(screen.queryByText(/more —/)).toBeNull();
  });

  it("memoizes rows: an unrelated store update that produces a new array of the same log objects does not re-render every row", () => {
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
