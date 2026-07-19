import { describe, it, expect, afterEach, beforeEach, vi } from "vite-plus/test";
import type { ReactNode } from "react";
import { getDefaultStore } from "jotai";
import { render, screen, cleanup, act } from "@testing-library/react";
import { TraceList } from "./trace-list";
import { tracesAtom, selectedTraceAtom } from "@/stores/telemetry";
import { traceSearchAtom } from "@/stores/filters";
import { selectedTraceIdAtom } from "@/stores/navigation";
import { makeTrace } from "@/test/factories";
import { LIST_DISPLAY_CAP } from "@/lib/list-render-cap";
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
// proxy for "how many rows actually re-rendered" — memoization is only
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
  store.set(tracesAtom, []);
  store.set(traceSearchAtom, "");
  store.set(selectedTraceAtom, null);
  store.set(selectedTraceIdAtom, null);
  requestMock.mockReset();
  requestMock.mockResolvedValue({ traces: { items: [], hasNextPage: false, endCursor: null } });
  pillRenders.current = 0;
});
afterEach(cleanup);

function makeTraces(count: number) {
  return Array.from({ length: count }, (_, i) =>
    makeTrace({
      traceId: `trace-${i}`,
      startTime: `2024-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
    }),
  );
}

describe("TraceList row rendering", () => {
  it("renders one row per trace when under the display cap", () => {
    const store = getDefaultStore();
    store.set(tracesAtom, makeTraces(3));

    render(<TraceList />);

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(4); // + header row
  });

  it("caps rendered rows at LIST_DISPLAY_CAP and reports the hidden count", () => {
    const store = getDefaultStore();
    const total = LIST_DISPLAY_CAP + 7;
    store.set(tracesAtom, makeTraces(total));

    render(<TraceList />);

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(LIST_DISPLAY_CAP + 1);
    expect(screen.getByText(/\+7 more/)).toBeTruthy();
  });

  it("does not show the overflow notice when at or under the cap", () => {
    const store = getDefaultStore();
    store.set(tracesAtom, makeTraces(LIST_DISPLAY_CAP));

    render(<TraceList />);

    expect(screen.queryByText(/more —/)).toBeNull();
  });

  it("memoizes rows: an unrelated store update that produces a new array of the same trace objects does not re-render every row", () => {
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
