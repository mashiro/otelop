import { describe, it, expect, afterEach, beforeEach, vi } from "vite-plus/test";
import type { ReactNode } from "react";
import { getDefaultStore } from "jotai";
import { render, screen, cleanup, within, waitFor, act } from "@testing-library/react";
import { MetricList } from "./metric-list";
import {
  metricSearchResultAtom,
  metricsAtom,
  renderWindowMaxAtom,
  addMetricAtom,
} from "@/stores/telemetry";
import { metricSearchAtom } from "@/stores/filters";
import { selectedMetricKeyAtom } from "@/stores/navigation";
import { makeMetric, TEST_RENDER_WINDOW_MAX } from "@/test/factories";
import { SIGNAL_PAGE_SIZE } from "@/hooks/use-signal-list-page";
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
  store.set(renderWindowMaxAtom, TEST_RENDER_WINDOW_MAX);
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

// Zero-padded so string sort (MetricList sorts by name.localeCompare, not
// insertion order) matches numeric/insertion order — needed for the render
// window tests below to reason about which rows are visible after a slide.
function makeMetrics(count: number) {
  return Array.from({ length: count }, (_, i) =>
    makeMetric({ name: `metric-${String(i).padStart(5, "0")}` }),
  );
}

describe("MetricList row rendering", () => {
  it("renders one row per metric when under the display cap", () => {
    const store = getDefaultStore();
    store.set(metricsAtom, makeMetrics(3));

    render(<MetricList />);

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(4); // + header row
  });

  it("caps rendered rows at TEST_RENDER_WINDOW_MAX on initial mount", () => {
    const store = getDefaultStore();
    const total = TEST_RENDER_WINDOW_MAX + 3;
    store.set(metricsAtom, makeMetrics(total));

    render(<MetricList />);

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(TEST_RENDER_WINDOW_MAX + 1);
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });

  it("does not show Load more when loaded rows are within the cap", () => {
    const store = getDefaultStore();
    store.set(metricsAtom, makeMetrics(TEST_RENDER_WINDOW_MAX));

    render(<MetricList />);

    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
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

// MetricList has no server-side pagination — its render window only ever
// slides over what's already in metricsAtom (metric-list.tsx's handleSlide).
// Order comes from name.localeCompare, not arrival time, so a "live" metric
// re-sorting to the front behaves exactly like a live prepend in
// trace-list.tsx/log-list.tsx — the same anchor mechanic applies to a
// re-sort as to a literal prepend.
describe("MetricList render window (bounded sliding)", () => {
  it("slides onto already-loaded rows when Load more is clicked", () => {
    const store = getDefaultStore();
    const total = TEST_RENDER_WINDOW_MAX + SIGNAL_PAGE_SIZE + 50;
    store.set(metricsAtom, makeMetrics(total));

    render(<MetricList />);
    expect(screen.getByText("metric-00000")).toBeTruthy();

    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });

    expect(screen.getAllByRole("row")).toHaveLength(TEST_RENDER_WINDOW_MAX + 1);
    expect(screen.queryByText("metric-00000")).toBeNull();
    expect(screen.getByText(`metric-${String(SIGNAL_PAGE_SIZE).padStart(5, "0")}`)).toBeTruthy();
  });

  it("resets the render window to the head when the search changes", () => {
    const store = getDefaultStore();
    store.set(metricsAtom, makeMetrics(TEST_RENDER_WINDOW_MAX + SIGNAL_PAGE_SIZE + 50));

    render(<MetricList />);
    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    expect(screen.queryByText("metric-00000")).toBeNull();

    // "metric-" matches every preset name, so the filtered list stays
    // populated purely client-side (stores/filters.ts's filteredMetricsAtom
    // client-side substring branch — no need to wait on the search request).
    act(() => {
      store.set(metricSearchAtom, "metric-");
    });

    expect(screen.getByText("metric-00000")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(TEST_RENDER_WINDOW_MAX + 1);
  });

  it("never mounts more rows than the configured max, even immediately after repeated sliding", () => {
    const store = getDefaultStore();
    store.set(renderWindowMaxAtom, 3);
    store.set(metricsAtom, makeMetrics(1000));

    render(<MetricList />);
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

  it("stays at the head as a re-sorted-to-front metric arrives, letting the last visible row fall out of the window", () => {
    const store = getDefaultStore();
    store.set(renderWindowMaxAtom, 3);
    store.set(metricsAtom, [
      makeMetric({ serviceName: "svc", name: "b-metric" }),
      makeMetric({ serviceName: "svc", name: "c-metric" }),
      makeMetric({ serviceName: "svc", name: "d-metric" }),
    ]);

    render(<MetricList />);
    expect(screen.getByText("b-metric")).toBeTruthy();
    expect(screen.getByText("c-metric")).toBeTruthy();
    expect(screen.getByText("d-metric")).toBeTruthy();

    act(() => {
      store.set(addMetricAtom, makeMetric({ serviceName: "svc", name: "a-metric" }));
    });

    expect(screen.getByText("a-metric")).toBeTruthy();
    expect(screen.getByText("b-metric")).toBeTruthy();
    expect(screen.getByText("c-metric")).toBeTruthy();
    expect(screen.queryByText("d-metric")).toBeNull();
  });

  it("keeps the visible rows stable when a row is inserted while scrolled into history, growing the newer count instead of shifting content", () => {
    const store = getDefaultStore();
    store.set(renderWindowMaxAtom, 2);
    store.set(metricsAtom, [
      makeMetric({ serviceName: "svc", name: "b-metric" }),
      makeMetric({ serviceName: "svc", name: "c-metric" }),
      makeMetric({ serviceName: "svc", name: "d-metric" }),
      makeMetric({ serviceName: "svc", name: "e-metric" }),
      makeMetric({ serviceName: "svc", name: "f-metric" }),
    ]);

    render(<MetricList />);
    expect(screen.getByText("b-metric")).toBeTruthy();
    expect(screen.getByText("c-metric")).toBeTruthy();

    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    expect(screen.getByText("d-metric")).toBeTruthy();
    expect(screen.getByText("e-metric")).toBeTruthy();
    expect(screen.getByRole("button", { name: /2 earlier/ })).toBeTruthy();

    act(() => {
      store.set(addMetricAtom, makeMetric({ serviceName: "svc", name: "a-metric" }));
    });

    expect(screen.getByText("d-metric")).toBeTruthy();
    expect(screen.getByText("e-metric")).toBeTruthy();
    expect(screen.getByRole("button", { name: /3 earlier/ })).toBeTruthy();
  });

  it("returns to the head when 'back to top' is clicked", () => {
    const store = getDefaultStore();
    store.set(renderWindowMaxAtom, 2);
    store.set(metricsAtom, [
      makeMetric({ serviceName: "svc", name: "b-metric" }),
      makeMetric({ serviceName: "svc", name: "c-metric" }),
      makeMetric({ serviceName: "svc", name: "d-metric" }),
      makeMetric({ serviceName: "svc", name: "e-metric" }),
      makeMetric({ serviceName: "svc", name: "f-metric" }),
    ]);

    render(<MetricList />);
    act(() => {
      screen.getByRole("button", { name: "Load more" }).click();
    });
    expect(screen.getByText("e-metric")).toBeTruthy();

    act(() => {
      screen.getByRole("button", { name: /earlier — back to top/ }).click();
    });

    expect(screen.getByText("b-metric")).toBeTruthy();
    expect(screen.getByText("c-metric")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /back to top/ })).toBeNull();
  });
});
