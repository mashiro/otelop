import { describe, it, expect, afterEach } from "vite-plus/test";
import { render, screen, cleanup } from "@testing-library/react";
import { MetricSummary } from "./metric-summary";
import {
  makeDataPoint,
  makeMetric,
  makeAggregatePoint,
  makeAggregateSeries,
} from "@/test/factories";
import type { MetricFacet } from "@/lib/metric-catalog";

const MODEL_FACET: MetricFacet = { attributes: ["model"], label: "Model" };
const liveWindow = (range: "5m" | "1h" | "all") => ({ mode: "live" as const, range });

afterEach(cleanup);

describe("MetricSummary", () => {
  it("renders 'Increase · <range label>' for a monotonic sum", () => {
    const metric = makeMetric({
      type: "Sum",
      dataPoints: [makeDataPoint({ id: "a", value: 5, cumulative: 5 })],
    });

    render(
      <MetricSummary
        metric={metric}
        facet={null}
        window={liveWindow("5m")}
        rangeDataPoints={metric.dataPoints}
        aggregatedSeries={null}
      />,
    );

    expect(screen.getByText("Increase · 5m")).toBeTruthy();
    expect(screen.queryByText(/Since observing/)).toBeNull();
  });

  it("shows the latest value for a Gauge", () => {
    const metric = makeMetric({
      type: "Gauge",
      dataPoints: [
        makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", value: 1 }),
        makeDataPoint({ id: "b", timestamp: "2024-01-01T00:00:30Z", value: 2 }),
      ],
    });

    render(
      <MetricSummary
        metric={metric}
        facet={null}
        window={liveWindow("all")}
        rangeDataPoints={metric.dataPoints}
        aggregatedSeries={null}
      />,
    );

    expect(screen.getByText("Latest · All")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("uses the latest Gauge observation in a breakdown, not the latest bucket mean", () => {
    const rangeDataPoints = [
      makeDataPoint({
        id: "a",
        timestamp: "2024-01-01T00:00:01Z",
        attributes: { model: "opus" },
        value: 0,
      }),
      makeDataPoint({
        id: "b",
        timestamp: "2024-01-01T00:00:02Z",
        attributes: { model: "opus" },
        value: 100,
      }),
    ];
    const metric = makeMetric({ type: "Gauge", dataPoints: rangeDataPoints });

    render(
      <MetricSummary
        metric={metric}
        facet={MODEL_FACET}
        window={liveWindow("1h")}
        rangeDataPoints={rangeDataPoints}
        aggregatedSeries={[
          makeAggregateSeries({
            groupValues: ["opus"],
            points: [makeAggregatePoint({ value: 50 })],
          }),
        ]}
      />,
    );

    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.queryByText("50")).toBeNull();
  });

  it("sums the latest observation from every underlying Gauge series in a breakdown", () => {
    const rangeDataPoints = [
      makeDataPoint({
        id: "worker-1-old",
        seriesKey: "worker-1",
        timestamp: "2024-01-01T00:00:01Z",
        attributes: { model: "opus", worker: "1" },
        value: 5,
      }),
      makeDataPoint({
        id: "worker-1-latest",
        seriesKey: "worker-1",
        timestamp: "2024-01-01T00:00:02Z",
        attributes: { model: "opus", worker: "1" },
        value: 10,
      }),
      makeDataPoint({
        id: "worker-2-latest",
        seriesKey: "worker-2",
        timestamp: "2024-01-01T00:00:03Z",
        attributes: { model: "opus", worker: "2" },
        value: 20,
      }),
    ];
    const metric = makeMetric({ type: "Gauge", dataPoints: rangeDataPoints });

    render(
      <MetricSummary
        metric={metric}
        facet={MODEL_FACET}
        window={liveWindow("all")}
        rangeDataPoints={rangeDataPoints}
        aggregatedSeries={null}
      />,
    );

    expect(screen.getByText("30")).toBeTruthy();
    expect(screen.queryByText("20")).toBeNull();
  });

  it("sums range-scoped raw point values per attribute combo for facet=All", () => {
    const rangeDataPoints = [
      makeDataPoint({ id: "a", attributes: { model: "opus" }, value: 2, cumulative: 100 }),
      makeDataPoint({ id: "b", attributes: { model: "opus" }, value: 3, cumulative: 101 }),
      makeDataPoint({ id: "c", attributes: { model: "haiku" }, value: 1, cumulative: 50 }),
    ];
    const metric = makeMetric({ type: "Sum", dataPoints: rangeDataPoints });

    render(
      <MetricSummary
        metric={metric}
        facet={null}
        window={liveWindow("all")}
        rangeDataPoints={rangeDataPoints}
        aggregatedSeries={null}
      />,
    );

    expect(screen.getByText('model="opus"')).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText('model="haiku"')).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("keeps every point from an arbitrary fixed window in the Increase total", () => {
    const rangeDataPoints = [
      makeDataPoint({
        id: "older",
        timestamp: "2024-01-01T00:10:00Z",
        value: 5.4,
        cumulative: 5.4,
      }),
      makeDataPoint({
        id: "newer",
        timestamp: "2024-01-01T01:50:00Z",
        value: 1.7,
        cumulative: 7.1,
      }),
    ];
    const metric = makeMetric({ type: "Sum", unit: "USD", dataPoints: rangeDataPoints });

    render(
      <MetricSummary
        metric={metric}
        facet={null}
        window={{
          mode: "fixed",
          from: "2024-01-01T00:00:00Z",
          to: "2024-01-01T02:00:00Z",
        }}
        rangeDataPoints={rangeDataPoints}
        aggregatedSeries={null}
      />,
    );

    expect(screen.getByText("Increase · Custom")).toBeTruthy();
    expect(screen.getByText("7.1 USD")).toBeTruthy();
  });

  it("sums the fetched aggregate series' value per group when a facet is active", () => {
    const rangeDataPoints = [
      makeDataPoint({ id: "a", attributes: { model: "opus" }, cumulative: 1 }),
      makeDataPoint({ id: "b", attributes: { model: "haiku" }, cumulative: 1 }),
    ];
    const aggregatedSeries = [
      makeAggregateSeries({
        groupValues: ["opus"],
        points: [makeAggregatePoint({ value: 4 }), makeAggregatePoint({ value: 6 })],
      }),
      makeAggregateSeries({ groupValues: ["haiku"], points: [makeAggregatePoint({ value: 2 })] }),
    ];
    const metric = makeMetric({ type: "Sum", dataPoints: rangeDataPoints });

    render(
      <MetricSummary
        metric={metric}
        facet={MODEL_FACET}
        window={liveWindow("all")}
        rangeDataPoints={rangeDataPoints}
        aggregatedSeries={aggregatedSeries}
      />,
    );

    expect(screen.getByText("opus")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getByText("haiku")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("shows the latest mean and its count for distribution metrics", () => {
    const rangeDataPoints = [
      makeDataPoint({
        id: "a",
        attributes: { model: "opus" },
        countCumulative: 1,
        sumCumulative: 1,
      }),
    ];
    const aggregatedSeries = [
      makeAggregateSeries({
        groupValues: ["opus"],
        points: [
          makeAggregatePoint({ timestamp: "2024-01-01T00:00:00Z", value: 10, count: 4 }),
          makeAggregatePoint({ timestamp: "2024-01-01T00:00:30Z", value: 20, count: 2 }),
        ],
      }),
    ];
    const metric = makeMetric({ type: "Histogram", dataPoints: rangeDataPoints });

    render(
      <MetricSummary
        metric={metric}
        facet={MODEL_FACET}
        window={liveWindow("all")}
        rangeDataPoints={rangeDataPoints}
        aggregatedSeries={aggregatedSeries}
      />,
    );

    expect(screen.getByText("Latest · All")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();
    expect(screen.getByText("count 2")).toBeTruthy();
  });

  it("shows window-wide histogram percentiles instead of the latest point", () => {
    const metric = makeMetric({
      type: "Histogram",
      unit: "ms",
      dataPoints: [makeDataPoint({ value: 999, count: 1 })],
    });

    render(
      <MetricSummary
        metric={metric}
        facet={null}
        window={liveWindow("1h")}
        rangeDataPoints={metric.dataPoints}
        aggregatedSeries={null}
        distributionGroupBy={null}
        distributionStats={[
          {
            groupValues: [],
            attributes: {},
            count: 100,
            mean: 12,
            min: 1,
            max: 80,
            p50: 10,
            p90: 25,
            p95: 40,
            p99: 70,
          },
        ]}
      />,
    );

    expect(screen.getByText("Distribution · 1h")).toBeTruthy();
    expect(screen.getByText("100")).toBeTruthy();
    for (const label of ["Average", "Median", "P90", "P95", "P99", "Min", "Max"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText("Latest · 1h")).toBeNull();
  });

  it("renders histogram statistics per selected breakdown group", () => {
    const rangeDataPoints = [
      makeDataPoint({ id: "a", attributes: { model: "opus", worker: "1" } }),
      makeDataPoint({ id: "b", attributes: { model: "haiku", worker: "2" } }),
    ];
    const metric = makeMetric({ type: "Histogram", dataPoints: rangeDataPoints });

    render(
      <MetricSummary
        metric={metric}
        facet={MODEL_FACET}
        window={liveWindow("5m")}
        rangeDataPoints={rangeDataPoints}
        aggregatedSeries={null}
        distributionGroupBy={["model"]}
        distributionStats={[
          {
            groupValues: ["haiku"],
            attributes: {},
            count: 20,
            mean: 2,
            min: 1,
            max: 3,
            p50: 2,
            p90: 3,
            p95: 3,
            p99: 3,
          },
          {
            groupValues: ["opus"],
            attributes: {},
            count: 40,
            mean: 10,
            min: 5,
            max: 20,
            p50: 9,
            p90: 18,
            p95: 19,
            p99: 20,
          },
        ]}
      />,
    );

    expect(screen.getByText("haiku")).toBeTruthy();
    expect(screen.getByText("opus")).toBeTruthy();
    expect(screen.getAllByText("20").length).toBeGreaterThan(0);
    expect(screen.getByText("40")).toBeTruthy();
    expect(screen.queryByText(/60 observations/)).toBeNull();
  });

  it("renders the tile's main value without font-mono / tabular-nums (proportional sans figures)", () => {
    const metric = makeMetric({
      type: "Sum",
      dataPoints: [makeDataPoint({ id: "a", value: 5, cumulative: 5 })],
    });

    render(
      <MetricSummary
        metric={metric}
        facet={null}
        window={liveWindow("all")}
        rangeDataPoints={metric.dataPoints}
        aggregatedSeries={null}
      />,
    );

    const value = screen.getByText("5");
    expect(value.className).not.toContain("font-mono");
    expect(value.className).not.toContain("tabular-nums");
    expect(value.className).toContain("font-semibold");
  });
});
