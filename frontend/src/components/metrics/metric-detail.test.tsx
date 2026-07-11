import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, within, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MetricDetailBody } from "./metric-detail";
import { makeDataPoint, makeMetric } from "@/test/factories";

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
    return Promise.resolve({ metrics: { items: [] } });
  });
});
afterEach(cleanup);

// The breakdown facet tabs always include an "All" trigger too (see
// ALL_FACET in metric-detail.tsx), so "All" is ambiguous unless scoped to the
// range tablist specifically — the range tablist is always the last one in
// document order (breakdown's div comes first in the control row).
function rangeTablist() {
  const tablists = screen.getAllByRole("tablist");
  return tablists[tablists.length - 1]!;
}

describe("MetricDetailBody control row", () => {
  it("renders breakdown facet tabs and range tabs in the same row, defaulting range to All", () => {
    const metric = makeMetric({
      type: "Sum",
      dataPoints: [
        makeDataPoint({ id: "a", attributes: { model: "opus" }, cumulative: 1 }),
        makeDataPoint({ id: "b", attributes: { model: "haiku" }, cumulative: 2 }),
      ],
    });

    render(<MetricDetailBody metric={metric} />);

    expect(screen.getByText("Breakdown")).toBeTruthy();
    const range = within(rangeTablist());
    for (const label of ["1m", "5m", "15m", "30m", "1h", "All"]) {
      expect(range.getByRole("tab", { name: label })).toBeTruthy();
    }
    expect(range.getByRole("tab", { name: "All" }).getAttribute("data-active")).not.toBeNull();

    // Both tab groups share one row container.
    const breakdownLabel = screen.getByText("Breakdown");
    const rangeTab = range.getByRole("tab", { name: "5m" });
    const row = breakdownLabel.closest("div")?.parentElement;
    expect(row?.contains(rangeTab)).toBe(true);
  });

  it("switches the selected range when a range tab is clicked", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", value: 1 })],
    });

    render(<MetricDetailBody metric={metric} />);
    const range = within(rangeTablist());
    fireEvent.click(range.getByRole("tab", { name: "5m" }));

    expect(range.getByRole("tab", { name: "5m" }).getAttribute("data-active")).not.toBeNull();
    expect(range.getByRole("tab", { name: "All" }).getAttribute("data-active")).toBeNull();
  });

  it("fetches a server-side range backfill once per range change (shared by tiles, chart, and table)", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", value: 1 })],
    });

    render(<MetricDetailBody metric={metric} />);
    fireEvent.click(screen.getByRole("tab", { name: "5m" }));

    // Once for the initial "All" mount, once more after switching to "5m".
    const rangeCalls = requestMock.mock.calls.filter(
      (c) => (c[0] as GqlDocument).definitions[0]?.name?.value === "MetricRange",
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
    expect(screen.getByText("Total · All")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "1h" }));
    expect(screen.getByText("Total · 1h")).toBeTruthy();
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

    fireEvent.click(screen.getByRole("tab", { name: "5m" }));

    await waitFor(() => expect(screen.getByText("Data Points (2)")).toBeTruthy());
  });
});
