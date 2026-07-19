import { describe, it, expect, afterEach, beforeEach, vi } from "vite-plus/test";
import type { ReactNode } from "react";
import { getDefaultStore } from "jotai";
import { render, screen, cleanup, within, waitFor, act } from "@testing-library/react";
import { MetricList } from "./metric-list";
import { metricSearchResultAtom, metricsAtom } from "@/stores/telemetry";
import { metricSearchAtom } from "@/stores/filters";
import { selectedMetricKeyAtom } from "@/stores/navigation";
import { makeMetric } from "@/test/factories";
import { LIST_DISPLAY_CAP } from "@/lib/list-render-cap";
import type { MetricsListQuery, MetricsListQueryVariables } from "@/gql/graphql";

// Base UI's ScrollArea calls Element.getAnimations(), which happy-dom (this
// project's test environment) doesn't implement — see the identical mock in
// metric-detail.test.tsx.
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// A leaf every row renders (the type Pill) whose render count doubles as a
// proxy for "how many rows actually re-rendered" — this guards the React
// Compiler's row-level bail-out (MetricRow is a plain function; no
// React.memo involved). The mock preserves children as plain text, so every
// other test's text assertions on a metric's type column are unaffected.
const { pillRenders } = vi.hoisted(() => ({ pillRenders: { current: 0 } }));
vi.mock("@/components/common/pill", () => ({
  Pill: ({ children }: { children: ReactNode }) => {
    pillRenders.current++;
    return <span>{children}</span>;
  },
}));

// The hook is exercised for real (not mocked) in this file now: the bug this
// suite guards against (a zero-hit search wiping metricsAtom, taking the
// search box down with it) lives in the wiring between MetricList,
// hooks/use-metric-list-search.ts, and stores/filters.ts's
// filteredMetricsAtom, not in any one of them alone.
const { requestMock } = vi.hoisted(() => ({
  requestMock:
    vi.fn<(doc: unknown, vars: MetricsListQueryVariables) => Promise<MetricsListQuery>>(),
}));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

beforeEach(() => {
  const store = getDefaultStore();
  store.set(metricsAtom, []);
  store.set(metricSearchAtom, "");
  store.set(selectedMetricKeyAtom, null);
  store.set(metricSearchResultAtom, { search: "", items: [] });
  requestMock.mockReset();
  requestMock.mockResolvedValue({ metrics: { items: [] } });
  pillRenders.current = 0;
});
afterEach(cleanup);

function queryMetric(overrides = {}) {
  const { dataPoints: _dataPoints, ...metric } = makeMetric(overrides);
  return metric;
}

// The metrics list's initial load stopped selecting dataPoints (issue #162);
// the "Points"/"Latest Value" columns must render from the cheap
// pointCount/latestValue summary fields the server computes instead of
// deriving them from dataPoints.length / dataPoints.at(-1)?.value.
describe("MetricList", () => {
  it("renders Points/Latest Value from pointCount/latestValue, not dataPoints", () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [
      makeMetric({
        serviceName: "frontend",
        name: "http.requests",
        pointCount: 42,
        latestValue: 7.5,
        dataPoints: [],
      }),
    ]);

    render(<MetricList />);

    expect(screen.getByText("http.requests")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("7.5")).toBeTruthy();
  });

  it("renders '-' for latestValue when null (no meaningful point yet)", () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [
      makeMetric({ name: "fresh.metric", pointCount: 0, latestValue: null, dataPoints: [] }),
    ]);

    render(<MetricList />);

    expect(screen.getByText("fresh.metric")).toBeTruthy();
    // Column order (see MetricList): Service, Name, Description, Type, Unit,
    // Points, Latest Value, Received — index 6 is Latest Value.
    const row = screen.getByText("fresh.metric").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[5]?.textContent).toBe("0");
    expect(cells[6]?.textContent).toBe("-");
  });

  // The blocker this suite exists to catch: a search with zero matches used
  // to REPLACE metricsAtom with the (empty) server result, and
  // metric-list.tsx's `allMetrics.length === 0` guard then rendered the full
  // EmptyState — unmounting the toolbar, the search box, and any way back.
  it("a zero-hit active search keeps the search box mounted instead of falling back to EmptyState", async () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [makeMetric({ serviceName: "frontend", name: "http.requests" })]);
    store.set(metricSearchAtom, "nomatch");
    requestMock.mockResolvedValue({ metrics: { items: [] } });

    render(<MetricList />);

    await waitFor(() => expect(screen.getByText("No matching metrics")).toBeTruthy());
    expect(screen.getByPlaceholderText("Search metrics...")).toBeTruthy();
  });

  it("recovers the list once a zero-hit search is cleared", async () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [makeMetric({ serviceName: "frontend", name: "http.requests" })]);
    store.set(metricSearchAtom, "nomatch");
    requestMock.mockResolvedValue({ metrics: { items: [] } });

    render(<MetricList />);
    await waitFor(() => expect(screen.getByText("No matching metrics")).toBeTruthy());

    act(() => {
      store.set(metricSearchAtom, "");
    });

    await waitFor(() => expect(screen.getByText("http.requests")).toBeTruthy());
  });

  it("does not clobber the metrics buffer on a zero-hit search", async () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [
      makeMetric({ serviceName: "frontend", name: "http.requests" }),
      makeMetric({ serviceName: "frontend", name: "http.errors" }),
    ]);
    store.set(metricSearchAtom, "nomatch");
    requestMock.mockResolvedValue({ metrics: { items: [] } });

    render(<MetricList />);

    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(store.get(metricsAtom)).toHaveLength(2);
  });

  it("renders a server match that is no longer present in the bounded live buffer", async () => {
    const store = getDefaultStore();
    store.set(metricsAtom, []);
    store.set(metricSearchAtom, "archive");
    requestMock.mockResolvedValue({
      metrics: { items: [queryMetric({ serviceName: "archive", name: "old.requests" })] },
    });

    render(<MetricList />);

    await waitFor(() => expect(screen.getByText("old.requests")).toBeTruthy());
    expect(store.get(metricsAtom)).toEqual([]);
    expect(screen.getByPlaceholderText("Search metrics...")).toBeTruthy();
  });

  it("skips the redundant full-list fetch on mount when search is empty and the buffer already has data", async () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [makeMetric({ name: "http.requests" })]);
    store.set(metricSearchAtom, "");

    render(<MetricList />);

    // Give any accidental fetch a tick to fire before asserting its absence.
    await act(async () => Promise.resolve());
    expect(requestMock).not.toHaveBeenCalled();
  });
});

function makeMetrics(count: number) {
  return Array.from({ length: count }, (_, i) => makeMetric({ name: `metric-${i}` }));
}

describe("MetricList row rendering", () => {
  it("renders one row per metric when under the display cap", () => {
    const store = getDefaultStore();
    store.set(metricsAtom, makeMetrics(3));

    render(<MetricList />);

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(4); // + header row
  });

  it("caps rendered rows at LIST_DISPLAY_CAP and reports the hidden count", () => {
    const store = getDefaultStore();
    const total = LIST_DISPLAY_CAP + 3;
    store.set(metricsAtom, makeMetrics(total));

    render(<MetricList />);

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(LIST_DISPLAY_CAP + 1);
    expect(screen.getByText(/\+3 more/)).toBeTruthy();
  });

  it("does not show the overflow notice when at or under the cap", () => {
    const store = getDefaultStore();
    store.set(metricsAtom, makeMetrics(LIST_DISPLAY_CAP));

    render(<MetricList />);

    expect(screen.queryByText(/more —/)).toBeNull();
  });

  it("does not re-render every row when an unrelated store update produces a new array of the same metric objects (React Compiler bail-out)", () => {
    const store = getDefaultStore();
    store.set(metricsAtom, makeMetrics(5));

    render(<MetricList />);
    const rendersAfterMount = pillRenders.current;
    expect(rendersAfterMount).toBe(5);

    act(() => {
      store.set(metricsAtom, (prev) => [...prev]);
    });

    expect(pillRenders.current).toBe(rendersAfterMount);
  });

  it("re-renders the affected row when a single metric is updated in place", () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [makeMetric({ name: "http.requests", pointCount: 1 })]);

    render(<MetricList />);
    expect(screen.getByText("1")).toBeTruthy();

    act(() => {
      store.set(metricsAtom, [makeMetric({ name: "http.requests", pointCount: 2 })]);
    });

    expect(screen.getByText("2")).toBeTruthy();
  });
});
