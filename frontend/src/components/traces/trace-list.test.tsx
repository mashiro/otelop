import { describe, it, expect, afterEach, beforeEach, vi } from "vite-plus/test";
import type { ReactNode } from "react";
import { getDefaultStore } from "jotai";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import { TraceList } from "./trace-list";
import {
  tracesAtom,
  selectedTraceAtom,
  renderWindowMaxAtom,
  addTraceAtom,
  traceListWindowAtom,
} from "@/stores/telemetry";
import { traceSearchAtom } from "@/stores/filters";
import { selectedTraceIdAtom } from "@/stores/navigation";
import { makeTrace, TEST_RENDER_WINDOW_MAX } from "@/test/factories";
import { SIGNAL_PAGE_SIZE } from "@/hooks/use-signal-list-page";
import type { TracesPageQuery, TracesPageQueryVariables } from "@/gql/graphql";

// Base UI's ScrollArea calls Element.getAnimations(), which happy-dom (this
// project's test environment) doesn't implement — see the identical mock in
// metric-list.test.tsx.
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn<(doc: unknown, vars: TracesPageQueryVariables) => Promise<TracesPageQuery>>(),
}));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

// A leaf every row renders (the status Pill) whose render count doubles as a
// proxy for "how many rows actually re-rendered" — this guards the React
// Compiler's row-level bail-out (TraceRow is a plain function; no
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
  store.set(tracesAtom, []);
  store.set(traceSearchAtom, "");
  store.set(selectedTraceAtom, null);
  store.set(selectedTraceIdAtom, null);
  store.set(renderWindowMaxAtom, TEST_RENDER_WINDOW_MAX);
  requestMock.mockReset();
  requestMock.mockResolvedValue({ traces: { items: [], hasNextPage: false, endCursor: null } });
  pillRenders.current = 0;
});
afterEach(cleanup);

function makeTraces(count: number, idPrefix = "trace") {
  return Array.from({ length: count }, (_, i) =>
    makeTrace({
      traceId: `${idPrefix}-${i}`,
      serviceName: "checkout",
      startTime: `2024-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
    }),
  );
}

// A later hour than makeTraces()'s fixtures, so newestTraceStartFirst always
// sorts a live-arrived trace ahead of any preset row — see addTraceAtom in
// stores/telemetry.ts, which re-sorts on every WS insert.
function makeLiveTrace(id: string, minute: number) {
  return makeTrace({
    traceId: id,
    serviceName: "checkout",
    startTime: `2024-01-01T01:${String(minute).padStart(2, "0")}:00Z`,
  });
}

// Wire-shaped items (TracesPageQuery's item selection) for driving requestMock
// directly, as opposed to makeTraces()'s domain-shaped TraceData for
// presetting tracesAtom.
function makeQueryTraces(count: number, idPrefix = "q-trace"): TracesPageQuery["traces"]["items"] {
  return Array.from({ length: count }, (_, i) => ({
    traceId: `${idPrefix}-${i}`,
    serviceName: "checkout",
    spanCount: 1,
    startTime: `2024-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
    durationMs: 5,
    rootSpan: null,
  }));
}

// addTraceAtom re-sorts newest-first on every call, so seeding traces one at
// a time (rather than presetting tracesAtom directly) gives a
// production-faithful order for the anchor/live-insert tests below.
function seedLiveTraces(
  store: ReturnType<typeof getDefaultStore>,
  specs: Array<[id: string, minute: number]>,
) {
  for (const [id, minute] of specs) {
    store.set(addTraceAtom, makeLiveTrace(id, minute));
  }
}

describe("TraceList row rendering", () => {
  it("renders one row per trace when under the display cap", () => {
    const store = getDefaultStore();
    store.set(tracesAtom, makeTraces(3));

    render(<TraceList />);

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(4); // + header row
  });

  it("caps rendered rows at TEST_RENDER_WINDOW_MAX on initial mount", () => {
    const store = getDefaultStore();
    const total = TEST_RENDER_WINDOW_MAX + 7;
    store.set(tracesAtom, makeTraces(total));

    render(<TraceList />);

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(TEST_RENDER_WINDOW_MAX + 1);
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });

  it("does not show Load more when loaded rows are within the cap and there's no next page", () => {
    const store = getDefaultStore();
    store.set(tracesAtom, makeTraces(TEST_RENDER_WINDOW_MAX));

    render(<TraceList />);

    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("does not re-render every row when an unrelated store update produces a new array of the same trace objects (React Compiler bail-out)", () => {
    const store = getDefaultStore();
    store.set(tracesAtom, makeTraces(5));

    render(<TraceList />);
    const rendersAfterMount = pillRenders.current;
    expect(rendersAfterMount).toBe(5);

    act(() => {
      store.set(tracesAtom, (prev) => [...prev]);
    });

    expect(pillRenders.current).toBe(rendersAfterMount);
  });

  it("re-renders the affected row when a single trace is updated in place", () => {
    const store = getDefaultStore();
    store.set(tracesAtom, [makeTrace({ traceId: "t1", serviceName: "checkout" })]);

    render(<TraceList />);
    expect(screen.getByText("checkout")).toBeTruthy();

    act(() => {
      store.set(tracesAtom, [makeTrace({ traceId: "t1", serviceName: "billing" })]);
    });

    expect(screen.queryByText("checkout")).toBeNull();
    expect(screen.getByText("billing")).toBeTruthy();
  });
});

describe("TraceList render window (bounded sliding)", () => {
  it("slides onto already-loaded rows without fetching when Load more is clicked", () => {
    const store = getDefaultStore();
    const total = TEST_RENDER_WINDOW_MAX + SIGNAL_PAGE_SIZE + 50;
    store.set(tracesAtom, makeTraces(total));

    render(<TraceList />);
    const callsAfterMount = requestMock.mock.calls.length;
    expect(screen.getByText("trace-0")).toBeTruthy();

    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });

    // The window slides by SIGNAL_PAGE_SIZE — it never grows past the max.
    expect(screen.getAllByRole("row")).toHaveLength(TEST_RENDER_WINDOW_MAX + 1);
    expect(screen.queryByText("trace-0")).toBeNull();
    expect(screen.getByText(`trace-${SIGNAL_PAGE_SIZE}`)).toBeTruthy();
    // Sliding onto rows the store already has is client-side only.
    expect(requestMock.mock.calls.length).toBe(callsAfterMount);
  });

  it("falls through to fetching another page once loaded rows run out, then slides onto it", async () => {
    const store = getDefaultStore();
    requestMock.mockResolvedValueOnce({
      traces: {
        items: makeQueryTraces(TEST_RENDER_WINDOW_MAX),
        hasNextPage: true,
        endCursor: "cursor-1",
      },
    });
    requestMock.mockResolvedValueOnce({
      traces: {
        items: makeQueryTraces(SIGNAL_PAGE_SIZE, "older-trace"),
        hasNextPage: false,
        endCursor: null,
      },
    });

    render(<TraceList />);
    await waitFor(() => expect(store.get(tracesAtom)).toHaveLength(TEST_RENDER_WINDOW_MAX));

    const button = await screen.findByRole("button", { name: "Load more" });
    await act(async () => {
      button.click();
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1]?.[1]).toMatchObject({ after: "cursor-1" });

    // Once the fetched page lands in the store, the window slides onto it —
    // a click must not silently do nothing just because the fetch itself
    // doesn't resolve synchronously.
    await waitFor(() =>
      expect(store.get(tracesAtom)).toHaveLength(TEST_RENDER_WINDOW_MAX + SIGNAL_PAGE_SIZE),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("row")).toHaveLength(TEST_RENDER_WINDOW_MAX + 1),
    );
  });

  it("resets the render window to the head when the search changes", () => {
    const store = getDefaultStore();
    const total = TEST_RENDER_WINDOW_MAX + SIGNAL_PAGE_SIZE + 50;
    store.set(tracesAtom, makeTraces(total));

    render(<TraceList />);
    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    expect(screen.queryByText("trace-0")).toBeNull();

    // "checkout" matches every preset trace's serviceName, so the filtered
    // list stays populated purely client-side — no need to wait on the
    // search request use-trace-list-page.ts also kicks off.
    act(() => {
      store.set(traceSearchAtom, "checkout");
    });

    expect(screen.getByText("trace-0")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(TEST_RENDER_WINDOW_MAX + 1);
  });

  it("never mounts more rows than the configured max, even immediately after repeated sliding", () => {
    const store = getDefaultStore();
    store.set(traceListWindowAtom, { mode: "live", range: "all" });
    store.set(renderWindowMaxAtom, 3);
    store.set(tracesAtom, makeTraces(1000));

    render(<TraceList />);
    expect(screen.getAllByRole("row")).toHaveLength(4);

    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    expect(screen.getAllByRole("row")).toHaveLength(4);

    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("stays at the head as live rows arrive, letting the oldest visible row fall out of the window", () => {
    const store = getDefaultStore();
    store.set(traceListWindowAtom, { mode: "live", range: "all" });
    store.set(renderWindowMaxAtom, 3);
    seedLiveTraces(store, [
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);

    render(<TraceList />);
    expect(screen.getByText("c")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
    expect(screen.getByText("a")).toBeTruthy();

    act(() => {
      store.set(addTraceAtom, makeLiveTrace("d", 3));
    });

    expect(screen.getByText("d")).toBeTruthy();
    expect(screen.getByText("c")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
    expect(screen.queryByText("a")).toBeNull();
  });

  it("keeps the visible rows stable when a live row arrives while scrolled into history, growing the newer count instead of shifting content", () => {
    const store = getDefaultStore();
    store.set(traceListWindowAtom, { mode: "live", range: "all" });
    store.set(renderWindowMaxAtom, 2);
    seedLiveTraces(store, [
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 3],
      ["e", 4],
    ]);

    render(<TraceList />);
    expect(screen.getByText("e")).toBeTruthy();
    expect(screen.getByText("d")).toBeTruthy();

    // 5 loaded rows, window of 2: sliding by SIGNAL_PAGE_SIZE clamps
    // straight to the oldest available page (b, a).
    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    expect(screen.getByText("b")).toBeTruthy();
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.queryByText("e")).toBeNull();
    expect(screen.getByRole("button", { name: /3 newer/ })).toBeTruthy();

    act(() => {
      store.set(addTraceAtom, makeLiveTrace("f", 5));
    });

    // The anchor (row "b") holds — still showing b, a — while the newer
    // count grows to include the freshly arrived row.
    expect(screen.getByText("b")).toBeTruthy();
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByRole("button", { name: /4 newer/ })).toBeTruthy();
  });

  it("returns to the head when 'back to latest' is clicked", () => {
    const store = getDefaultStore();
    store.set(traceListWindowAtom, { mode: "live", range: "all" });
    store.set(renderWindowMaxAtom, 2);
    seedLiveTraces(store, [
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 3],
      ["e", 4],
    ]);

    render(<TraceList />);
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
