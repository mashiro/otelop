import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { getDefaultStore } from "jotai";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MetricDetailBody } from "./metric-detail";
import { makeDataPoint, makeMetric } from "@/test/factories";
import { activeTabAtom, selectedMetricKeyAtom, selectedMetricRangeAtom } from "@/stores/navigation";
import { DEFAULT_CHART_TIME_RANGE } from "@/lib/chart-time-range";

// Base UI's ScrollArea calls Element.getAnimations(), which happy-dom (this
// project's test environment) doesn't implement — an environment gap
// unrelated to this component, hit here only because these are the first
// tests to render MetricDetailBody's ScrollArea wrapper directly rather than
// its sub-pieces (DataPointsTable, MetricChart) standalone.
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// MetricDetailBody now owns the range state and both data hooks
// (use-metric-range-points.ts / use-metric-aggregate-series.ts) that used to
// live in MetricChart, so the tiles and the chart read the exact same
// range-scoped data — see metric-stats.ts's computeStatTiles. Both hooks go
// through the same gqlClient.request mock, dispatched by operation name.
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("@/lib/graphql", () => ({
  gqlClient: { request: requestMock },
}));

interface GqlDocument {
  definitions: { name?: { value: string } }[];
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((doc: GqlDocument) => {
    const opName = doc.definitions[0]?.name?.value;
    if (opName === "MetricAggregate") return Promise.resolve({ metricAggregate: [] });
    return Promise.resolve({ metricPoints: [] });
  });
  // selectedMetricRangeAtom (and the tab/key atoms the URL-persistence test
  // below drives) are real global atoms (see stores/navigation.ts), not
  // component-local state, so they must be reset between tests — otherwise
  // whichever values an earlier test left them on leak into the next mount.
  const store = getDefaultStore();
  store.set(selectedMetricRangeAtom, DEFAULT_CHART_TIME_RANGE);
  store.set(activeTabAtom, "traces");
  store.set(selectedMetricKeyAtom, null);
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

function selectRange(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Time range" }));
  const option = screen.getByRole("option", { name: label });
  fireEvent.pointerDown(option, { button: 0 });
  fireEvent.pointerUp(option, { button: 0 });
  fireEvent.click(option);
}

describe("MetricDetailBody control row", () => {
  it("renders breakdown facet tabs and the range select in the same row, defaulting to 1h", () => {
    const metric = makeMetric({
      type: "Sum",
      dataPoints: [
        makeDataPoint({ id: "a", attributes: { model: "opus" }, cumulative: 1 }),
        makeDataPoint({ id: "b", attributes: { model: "haiku" }, cumulative: 2 }),
      ],
    });

    render(<MetricDetailBody metric={metric} />);

    expect(screen.getByText("Breakdown")).toBeTruthy();
    const rangeSelect = screen.getByRole("combobox", { name: "Time range" });
    expect(rangeSelect.textContent).toContain("1h");

    // Both tab groups share one row container.
    const breakdownLabel = screen.getByText("Breakdown");
    const row = breakdownLabel.closest("div")?.parentElement;
    expect(row?.contains(rangeSelect)).toBe(true);
  });

  it("switches the selected range from the range select", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", value: 1 })],
    });

    render(<MetricDetailBody metric={metric} />);
    selectRange("5m");

    expect(screen.getByRole("combobox", { name: "Time range" }).textContent).toContain("5m");
  });

  it("persists the selected range to the URL so a reload/share reopens the same window", () => {
    const store = getDefaultStore();
    // MetricDetailBody is only ever rendered under the metrics tab with a
    // matching selection in the real app; selectedMetricRangeAtom's URL sync
    // (see navigation.ts's syncLocation) is keyed off that tab + metricKey
    // state, so the test sets it up explicitly rather than relying on the
    // component tree that normally does it (MetricDetail/MetricList).
    window.history.replaceState(null, "", "/");
    store.set(activeTabAtom, "metrics");
    store.set(selectedMetricKeyAtom, { serviceName: "frontend", name: "http.requests" });

    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", value: 1 })],
    });

    render(<MetricDetailBody metric={metric} />);
    selectRange("24h");

    expect(window.location.pathname + window.location.search).toBe(
      "/metrics/frontend/http.requests?range=24h",
    );
  });

  it("fetches a server-side range backfill once per range change (shared by tiles, chart, and table)", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", value: 1 })],
    });

    render(<MetricDetailBody metric={metric} />);
    selectRange("5m");

    // Once for the initial "1h" mount, once more after switching to "5m".
    const rangeCalls = requestMock.mock.calls.filter(
      (c) => (c[0] as GqlDocument).definitions[0]?.name?.value === "MetricPoints",
    );
    expect(rangeCalls.length).toBe(2);
  });
});

describe("MetricDetailBody stat tiles section label", () => {
  it("shows 'Total · <range label>' and updates when the range changes", () => {
    const metric = makeMetric({
      type: "Sum",
      dataPoints: [makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", cumulative: 1 })],
    });

    render(<MetricDetailBody metric={metric} />);
    expect(screen.getByText("Total · 1h")).toBeTruthy();

    selectRange("All");
    expect(screen.getByText("Total · All")).toBeTruthy();
  });

  it("renders no tiles section for a Gauge (no cumulative signal)", () => {
    const metric = makeMetric({
      type: "Gauge",
      dataPoints: [makeDataPoint({ id: "a", value: 1 }), makeDataPoint({ id: "b", value: 2 })],
    });

    render(<MetricDetailBody metric={metric} />);

    expect(screen.queryByText(/^Total ·/)).toBeNull();
  });
});

describe("MetricDetailBody data points table", () => {
  it("scopes the table's row count to the selected range window", async () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "old", timestamp: "2024-01-01T00:00:00Z", value: 1 }),
        makeDataPoint({ id: "recent", timestamp: "2024-01-01T00:19:00Z", value: 2 }),
        makeDataPoint({ id: "newest", timestamp: "2024-01-01T00:20:00Z", value: 3 }),
      ],
    });

    render(<MetricDetailBody metric={metric} />);
    expect(screen.getByText("Data Points (3)")).toBeTruthy();

    selectRange("5m");

    await waitFor(() => expect(screen.getByText("Data Points (2)")).toBeTruthy());
  });
});
