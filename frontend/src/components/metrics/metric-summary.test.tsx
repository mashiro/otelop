import { describe, it, expect, afterEach } from "vitest";
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

afterEach(cleanup);

describe("MetricSummary", () => {
  it("renders 'Total · <range label>' instead of the old 'Since observing' wording", () => {
    const metric = makeMetric({
      type: "Sum",
      dataPoints: [makeDataPoint({ id: "a", value: 5, cumulative: 5 })],
    });

    render(
      <MetricSummary
        metric={metric}
        facet={null}
        range="5m"
        rangeDataPoints={metric.dataPoints}
        aggregatedSeries={null}
      />,
    );

    expect(screen.getByText("Total · 5m")).toBeTruthy();
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
        range="all"
        rangeDataPoints={metric.dataPoints}
        aggregatedSeries={null}
      />,
    );

    expect(screen.getByText("Latest · All")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
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
        range="all"
        rangeDataPoints={rangeDataPoints}
        aggregatedSeries={null}
      />,
    );

    expect(screen.getByText('model="opus"')).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText('model="haiku"')).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
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
        range="all"
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
        range="all"
        rangeDataPoints={rangeDataPoints}
        aggregatedSeries={aggregatedSeries}
      />,
    );

    expect(screen.getByText("Latest · All")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();
    expect(screen.getByText("count 2")).toBeTruthy();
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
        range="all"
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
