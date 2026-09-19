import { createTestRouter } from "@/test/router";
import type { ReactElement } from "react";
let routing: Awaited<ReturnType<typeof createTestRouter>>;
function render(ui: ReactElement) {
  return renderUI(ui, { wrapper: routing.wrapper });
}
import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import type { ReactNode } from "react";
import {
  act,
  render as renderUI,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { MetricDetail, MetricDetailBody } from "./metric-detail";
import { metricsAtom } from "@/stores/telemetry";
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

beforeEach(async () => {
  routing = await createTestRouter("/metrics/frontend/http.requests");
  requestMock.mockReset();
  requestMock.mockImplementation((doc: GqlDocument) => {
    const opName = doc.definitions[0]?.name?.value;
    if (opName === "MetricAggregate") return Promise.resolve({ metricAggregate: [] });
    return Promise.resolve({ metricPoints: [] });
  });
});
afterEach(cleanup);

async function selectRange(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Time range" }));
  const option = await screen.findByRole("option", { name: label });
  await act(async () => {
    fireEvent.pointerDown(option, { button: 0 });
    fireEvent.pointerUp(option, { button: 0 });
    fireEvent.click(option);
  });
}

describe("MetricDetailBody control row", () => {
  it("renders breakdown facet tabs and the range select in the same row, defaulting to 1h", async () => {
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
    expect(rangeSelect.textContent).toContain("1 hour");

    // Both tab groups share one row container.
    const breakdownLabel = screen.getByText("Breakdown");
    const row = breakdownLabel.closest("div")?.parentElement;
    expect(row?.contains(rangeSelect)).toBe(true);
  });

  it("switches the selected range from the range select", async () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", value: 1 })],
    });

    render(<MetricDetailBody metric={metric} />);
    await selectRange("5 minutes");

    expect(screen.getByRole("combobox", { name: "Time range" }).textContent).toContain("5 minutes");
  });

  it("persists the selected range to the URL so a reload/share reopens the same window", async () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", value: 1 })],
    });

    render(<MetricDetailBody metric={metric} />);
    await selectRange("1 day");

    expect(routing.router.state.location.href).toBe("/metrics/frontend/http.requests?range=24h");
  });

  it("keeps Next visible and disabled in Live mode without changing the window on click", async () => {
    const metric = makeMetric({ serviceName: "frontend", name: "http.requests" });

    render(<MetricDetailBody metric={metric} />);

    const nextButton = screen.getByRole("button", { name: "Next window" });
    expect(nextButton.hasAttribute("disabled")).toBe(true);
    const initialUrl = routing.router.state.location.href;

    await act(async () => fireEvent.click(nextButton));

    expect(routing.router.state.location.href).toBe(initialUrl);
    expect(screen.getByRole("button", { name: "Live" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("combobox", { name: "Time range" }).textContent).toContain("1 hour");
  });

  it("moves to the previous metric window and fetches its explicit bounds", async () => {
    const metric = makeMetric({ serviceName: "frontend", name: "http.requests" });

    render(<MetricDetailBody metric={metric} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Previous window" })));

    expect(screen.getByRole("button", { name: "Next window" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Live" }).hasAttribute("disabled")).toBe(false);
    await waitFor(() => {
      const rangeCalls = requestMock.mock.calls.filter(
        (call) => (call[0] as GqlDocument).definitions[0]?.name?.value === "MetricPoints",
      );
      expect(rangeCalls).toHaveLength(2);
      expect(rangeCalls[1]?.[1]).toMatchObject({
        from: expect.any(String),
        to: expect.any(String),
      });
    });
    expect(routing.router.state.location.searchStr).toContain("from=");
    expect(routing.router.state.location.searchStr).toContain("to=");
  });

  it("fetches a server-side range backfill once per range change (shared by tiles, chart, and table)", async () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", value: 1 })],
    });

    render(<MetricDetailBody metric={metric} />);
    await selectRange("5 minutes");

    // Once for the initial "1h" mount, once more after switching to "5m".
    const rangeCalls = requestMock.mock.calls.filter(
      (c) => (c[0] as GqlDocument).definitions[0]?.name?.value === "MetricPoints",
    );
    expect(rangeCalls.length).toBe(2);
  });
});

describe("MetricDetailBody stat tiles section label", () => {
  it("shows 'Increase · <range label>' and updates when the range changes", async () => {
    const metric = makeMetric({
      type: "Sum",
      dataPoints: [makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", cumulative: 1 })],
    });

    render(<MetricDetailBody metric={metric} />);
    expect(screen.getByText("Increase · 1 hour")).toBeTruthy();

    await selectRange("All");
    expect(screen.getByText("Increase · All")).toBeTruthy();
  });

  it("renders the latest section for a Gauge", async () => {
    const metric = makeMetric({
      type: "Gauge",
      dataPoints: [makeDataPoint({ id: "a", value: 1 }), makeDataPoint({ id: "b", value: 2 })],
    });

    render(<MetricDetailBody metric={metric} />);

    expect(screen.getByText("Latest · 1 hour")).toBeTruthy();
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

    await selectRange("5 minutes");

    await waitFor(() => expect(screen.getByText("Data Points (2)")).toBeTruthy());
  });
});

// The data point sidebar (DetailSidebar) registers its own capture-phase
// Escape listener (hooks/use-keyboard-shortcut.ts), which runs before
// DetailPanel's bubble-phase one and consumes the event — the same
// one-Escape-per-level contract trace-detail.test.tsx verifies for spans
// (see "dismisses one detail level per Escape").
describe("MetricDetail data point sidebar", () => {
  it("gives the data point close button an accessible name distinct from the metric detail's own close button", async () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [
      makeMetric({
        serviceName: "frontend",
        name: "http.requests",
        dataPoints: [makeDataPoint({ id: "dp-a", attributes: { k: "v" } })],
      }),
    ]);

    render(<MetricDetail />);
    fireEvent.click(screen.getByText('k="v"').closest("tr")!);

    expect(screen.getByText("Data Point Details")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close data point details" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close details" })).toBeTruthy();
  });

  it("dismisses one detail level per Escape: the data point sidebar first, the metric detail second", async () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [
      makeMetric({
        serviceName: "frontend",
        name: "http.requests",
        dataPoints: [makeDataPoint({ id: "dp-a", attributes: { k: "v" } })],
      }),
    ]);

    render(<MetricDetail />);
    fireEvent.click(screen.getByText('k="v"').closest("tr")!);
    expect(screen.getByText("Data Point Details")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Data Point Details")).toBeNull();
    expect(screen.getByText("http.requests")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(routing.router.state.location.pathname).toBe("/metrics"));
  });

  // Regression for the bug where a time-window change (or live-buffer
  // eviction) drops the selected point from rangeDataPoints without
  // clearing selectedDpId: the sidebar unmounts on its own, so its
  // capture-phase Escape listener unmounts with it, and a single Escape
  // must reach DetailPanel's listener directly instead of being swallowed
  // by a sidebar the user can no longer see.
  it("closes the metric detail with a single Escape after the selected data point falls out of the range window", async () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [
      makeMetric({
        serviceName: "frontend",
        name: "http.requests",
        dataPoints: [
          makeDataPoint({ id: "old", timestamp: "2024-01-01T00:00:00Z", attributes: { k: "old" } }),
          makeDataPoint({
            id: "newest",
            timestamp: "2024-01-01T00:20:00Z",
            attributes: { k: "newest" },
          }),
        ],
      }),
    ]);

    render(<MetricDetail />);
    fireEvent.click(screen.getByText('k="old"').closest("tr")!);
    expect(screen.getByText("Data Point Details")).toBeTruthy();

    // Narrowing to "5m" (anchored on the newest point, 00:20) drops "old"
    // (00:00) from rangeDataPoints while selectedDpId still points at it.
    await selectRange("5 minutes");
    await waitFor(() => expect(screen.queryByText("Data Point Details")).toBeNull());

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(routing.router.state.location.pathname).toBe("/metrics"));
  });
});
