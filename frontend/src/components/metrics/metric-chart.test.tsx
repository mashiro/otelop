import { describe, it, expect, afterEach, vi } from "vite-plus/test";
import { render, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { MetricChart, timeWindowFromDrag } from "./metric-chart";
import { makeDataPoint, makeMetric } from "@/test/factories";
import type { MetricFacet } from "@/lib/metric-catalog";

vi.mock("@visx/responsive", () => ({
  ParentSize: ({
    children,
  }: {
    children: (size: { width: number; height: number }) => React.ReactNode;
  }) => children({ width: 800, height: 300 }),
}));

const REGION_FACET: MetricFacet = { attributes: ["region"], label: "Region" };

afterEach(cleanup);

describe("MetricChart", () => {
  it("converts a horizontal drag into an ordered fixed time window", () => {
    const domain: [Date, Date] = [
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-01-01T01:00:00Z"),
    ];

    expect(timeWindowFromDrag(domain, 75, 25, 100)).toEqual({
      mode: "fixed",
      from: "2024-01-01T00:15:00.000Z",
      to: "2024-01-01T00:45:00.000Z",
    });
  });

  it("ignores clicks and clamps a drag to the plot bounds", () => {
    const domain: [Date, Date] = [
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-01-01T01:00:00Z"),
    ];

    expect(timeWindowFromDrag(domain, 20, 22, 100)).toBeNull();
    expect(timeWindowFromDrag(domain, -20, 120, 100)).toEqual({
      mode: "fixed",
      from: "2024-01-01T00:00:00.000Z",
      to: "2024-01-01T01:00:00.000Z",
    });
  });

  it("renders with raw range points and no facet", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "dp-1", timestamp: "2024-01-01T00:00:00Z", value: 1 })],
    });

    expect(() =>
      render(
        <MetricChart
          metric={metric}
          facet={null}
          window={{ mode: "live", range: "all" }}
          aggregatedSeries={null}
          onWindowChange={() => {}}
        />,
      ),
    ).not.toThrow();
  });

  it("renders with a facet active and server-aggregated series", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "a1", attributes: { region: "A", worker: "1" }, value: 5 }),
        makeDataPoint({ id: "a2", attributes: { region: "A", worker: "2" }, value: 3 }),
      ],
    });

    expect(() =>
      render(
        <MetricChart
          metric={metric}
          facet={REGION_FACET}
          window={{ mode: "live", range: "5m" }}
          aggregatedSeries={[]}
          onWindowChange={() => {}}
        />,
      ),
    ).not.toThrow();
  });

  it("renders while the aggregated fetch hasn't landed yet (null)", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "a1", attributes: { region: "A" }, value: 1 })],
    });

    expect(() =>
      render(
        <MetricChart
          metric={metric}
          facet={REGION_FACET}
          window={{ mode: "live", range: "all" }}
          aggregatedSeries={null}
          onWindowChange={() => {}}
        />,
      ),
    ).not.toThrow();
  });
});

const visibilityMetric = makeMetric({
  dataPoints: ["A", "B", "C"].flatMap((region, index) => [
    makeDataPoint({
      id: `${region}-1`,
      timestamp: "2024-01-01T00:00:00Z",
      attributes: { region },
      value: index + 1,
    }),
    makeDataPoint({
      id: `${region}-2`,
      timestamp: "2024-01-01T00:00:10Z",
      attributes: { region },
      value: index + 2,
    }),
  ]),
});

function visibilityChart(metric = visibilityMetric, facet: MetricFacet | null = null) {
  return (
    <MetricChart
      metric={metric}
      facet={facet}
      window={{ mode: "live", range: "all" }}
      aggregatedSeries={
        facet
          ? ["A", "B", "C"].map((region, index) => ({
              groupValues: [region],
              points: [
                {
                  timestamp: "2024-01-01T00:00:00Z",
                  value: index + 1,
                  count: null,
                  sum: null,
                  min: null,
                  max: null,
                },
              ],
            }))
          : null
      }
      onWindowChange={() => {}}
    />
  );
}

function plottedSeries(container: HTMLElement) {
  return [...container.querySelectorAll("g[data-series]")].map((element) =>
    element.getAttribute("data-series"),
  );
}

describe("series visibility", () => {
  it.each([null, REGION_FACET])(
    "toggles raw and aggregated series and keeps hidden values out of tooltips (%j)",
    (facet) => {
      const { container } = render(visibilityChart(visibilityMetric, facet));
      const original = plottedSeries(container);
      const label = original[0]!;
      const toggle = screen.getByRole("button", { name: `Select ${label}` });
      fireEvent.click(toggle, { metaKey: true });
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
      expect(plottedSeries(container)).toEqual(original.slice(1));
      fireEvent.mouseMove(screen.getByLabelText(/Metric chart\. Drag/), {
        clientX: 100,
        clientY: 50,
      });
      const tooltip = container.querySelector(".visx-tooltip")!;
      expect(tooltip).not.toBeNull();
      expect(within(tooltip as HTMLElement).queryByText(label, { exact: true })).toBeNull();
      fireEvent.click(toggle, { metaKey: true });
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      expect(plottedSeries(container)).toEqual(original);
    },
  );

  it.each(["metaKey", "ctrlKey"])(
    "isolates on click and adds or removes a series with %s",
    (modifier) => {
      const { container } = render(visibilityChart());
      const original = plottedSeries(container);
      const first = screen.getByRole("button", { name: `Select ${original[0]}` });
      const second = screen.getByRole("button", { name: `Select ${original[1]}` });
      fireEvent.click(first);
      expect(plottedSeries(container)).toEqual([original[0]]);
      fireEvent.click(second, { [modifier]: true });
      expect(plottedSeries(container)).toEqual(original.slice(0, 2));
      fireEvent.click(first, { [modifier]: true });
      expect(plottedSeries(container)).toEqual([original[1]]);
      fireEvent.click(screen.getByRole("button", { name: "Show all" }));
      expect(plottedSeries(container)).toEqual(original);
      fireEvent.click(first, { [modifier]: true });
      expect(plottedSeries(container)).toEqual(original.slice(1));
    },
  );

  it("allows hiding every series and restoring them from the legend", () => {
    const { container } = render(visibilityChart());
    const original = plottedSeries(container);
    for (const label of original)
      fireEvent.click(screen.getByRole("button", { name: `Select ${label}` }), { metaKey: true });
    expect(plottedSeries(container)).toEqual([]);
    expect(screen.queryByText("No data points")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(plottedSeries(container)).toEqual(original);
  });

  it("preserves visibility across data updates and resets for another metric or facet", () => {
    const { container, rerender } = render(visibilityChart());
    const label = plottedSeries(container)[0]!;
    fireEvent.click(screen.getByRole("button", { name: `Select ${label}` }), { metaKey: true });
    rerender(
      visibilityChart({ ...visibilityMetric, dataPoints: [...visibilityMetric.dataPoints] }),
    );
    expect(plottedSeries(container)).toHaveLength(2);
    rerender(visibilityChart({ ...visibilityMetric, name: "another.metric" }));
    expect(plottedSeries(container)).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: `Select ${label}` }), { metaKey: true });
    rerender(visibilityChart({ ...visibilityMetric, name: "another.metric" }, REGION_FACET));
    expect(plottedSeries(container)).toHaveLength(3);
  });
});
