import { describe, expect, it } from "vite-plus/test";
import { makeAggregatePoint, makeAggregateSeries, makeDataPoint } from "@/test/factories";
import {
  bucketRawMetricPoints,
  buildAggregatedFacetSeries,
  buildRawGroupedSeries,
  chartTimeForAggregateTimestamp,
} from "./metric-chart-series";

const fixedWindow = {
  mode: "fixed" as const,
  from: "2024-01-01T00:00:07.500Z",
  to: "2024-01-01T00:10:07.500Z",
};

describe("metric chart series", () => {
  it("keeps a partial first aggregate bucket at the fixed window boundary", () => {
    expect(chartTimeForAggregateTimestamp("2024-01-01T00:00:04Z", fixedWindow)).toEqual(
      new Date(fixedWindow.from),
    );
  });

  it("buckets All-view Sum points instead of changing semantics from Breakdown", () => {
    const points = [
      makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:07.600Z", value: 1 }),
      makeDataPoint({ id: "b", timestamp: "2024-01-01T00:00:07.800Z", value: 5 }),
    ];

    expect(bucketRawMetricPoints(points, "Sum", fixedWindow)).toEqual([
      { time: new Date(fixedWindow.from), value: 6 },
    ]);
  });

  it("uses the server's per-bucket Gauge mean semantics", () => {
    const points = [
      makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:08Z", value: 0 }),
      makeDataPoint({ id: "b", timestamp: "2024-01-01T00:00:10Z", value: 100 }),
    ];

    expect(bucketRawMetricPoints(points, "Gauge", fixedWindow)[0]?.value).toBe(50);
  });

  it("averages each independent Gauge series before summing them in All", () => {
    const points = [
      makeDataPoint({ seriesKey: "worker-1", timestamp: "2024-01-01T00:00:08Z", value: 0 }),
      makeDataPoint({ seriesKey: "worker-1", timestamp: "2024-01-01T00:00:10Z", value: 100 }),
      makeDataPoint({ seriesKey: "worker-2", timestamp: "2024-01-01T00:00:09Z", value: 20 }),
    ];

    // worker-1 mean 50 + worker-2 mean 20, matching MetricAggregate.
    expect(bucketRawMetricPoints(points, "Gauge", fixedWindow)[0]?.value).toBe(70);
  });
});

const liveWindow = { mode: "live" as const, range: "all" as const };
const REGION_FACET = { attributes: ["region"], label: "Region" };

describe("buildRawGroupedSeries", () => {
  it("groups by full attribute combination via attrKey", () => {
    const points = [
      makeDataPoint({ id: "a", attributes: { region: "us" }, value: 1 }),
      makeDataPoint({ id: "b", attributes: { region: "eu" }, value: 2 }),
      makeDataPoint({ id: "c", attributes: { region: "us" }, value: 3 }),
    ];

    const series = buildRawGroupedSeries(points, "Sum", liveWindow);

    expect(series.map((s) => s.key).sort()).toEqual(['region="eu"', 'region="us"']);
  });

  it("labels the no-attributes group explicitly", () => {
    const points = [makeDataPoint({ id: "a", attributes: {}, value: 1 })];

    const series = buildRawGroupedSeries(points, "Sum", liveWindow);

    expect(series).toHaveLength(1);
    expect(series[0]?.label).toBe("(no attributes)");
  });

  it("derives one shared bucket width from the whole metric extent for every group", () => {
    // A short-lived group ("b") must not get its own, narrower bucket width
    // than the metric's overall extent, or its points would land on a
    // different grid than the long-lived group's ("a").
    const points = [
      makeDataPoint({ id: "a1", attributes: { g: "a" }, timestamp: "2024-01-01T00:00:00Z" }),
      makeDataPoint({ id: "a2", attributes: { g: "a" }, timestamp: "2024-01-01T02:00:00Z" }),
      makeDataPoint({ id: "b1", attributes: { g: "b" }, timestamp: "2024-01-01T00:00:00Z" }),
      makeDataPoint({ id: "b2", attributes: { g: "b" }, timestamp: "2024-01-01T00:00:05Z" }),
    ];

    const series = buildRawGroupedSeries(points, "Sum", liveWindow);
    const byLabel = new Map(series.map((s) => [s.label, s]));

    // Both groups' points collapse into the same coarse bucket boundaries
    // derived from the 2h extent, rather than group "b" bucketing its own
    // 5s span finely.
    const aTimes = byLabel.get('g="a"')!.points.map((p) => p.time.getTime());
    const bTimes = byLabel.get('g="b"')!.points.map((p) => p.time.getTime());
    expect(new Set(bTimes).size).toBeLessThan(2);
    expect(aTimes[0]).toBe(bTimes[0]);
  });

  it("assigns colors from seriesColorIndexes in insertion order", () => {
    const points = [
      makeDataPoint({ id: "a", attributes: { region: "us" } }),
      makeDataPoint({ id: "b", attributes: { region: "eu" } }),
    ];

    const series = buildRawGroupedSeries(points, "Sum", liveWindow);

    expect(series.every((s) => typeof s.color === "string" && s.color.length > 0)).toBe(true);
    // Colors are unique per distinct group (see seriesColorIndexes).
    expect(new Set(series.map((s) => s.color)).size).toBe(series.length);
  });
});

describe("buildAggregatedFacetSeries", () => {
  it("labels and colors each group from resolveFacetGroupColorIndex", () => {
    const aggregated = [
      makeAggregateSeries({ groupValues: ["us"], points: [makeAggregatePoint({ value: 1 })] }),
      makeAggregateSeries({ groupValues: ["eu"], points: [makeAggregatePoint({ value: 2 })] }),
    ];

    const series = buildAggregatedFacetSeries(aggregated, REGION_FACET, liveWindow);

    expect(series.map((s) => s.label)).toEqual(["us", "eu"]);
    expect(series.every((s) => typeof s.color === "string" && s.color.length > 0)).toBe(true);
  });

  it("sorts each group's points ascending by time", () => {
    const aggregated = [
      makeAggregateSeries({
        groupValues: ["us"],
        points: [
          makeAggregatePoint({ timestamp: "2024-01-01T00:00:10Z", value: 2 }),
          makeAggregatePoint({ timestamp: "2024-01-01T00:00:00Z", value: 1 }),
        ],
      }),
    ];

    const series = buildAggregatedFacetSeries(aggregated, REGION_FACET, liveWindow);

    expect(series[0]?.points.map((p) => p.value)).toEqual([1, 2]);
  });

  it("clamps a partial first bucket to the fixed window boundary via chartTimeForAggregateTimestamp", () => {
    const aggregated = [
      makeAggregateSeries({
        groupValues: ["us"],
        points: [makeAggregatePoint({ timestamp: "2024-01-01T00:00:04Z", value: 1 })],
      }),
    ];

    const series = buildAggregatedFacetSeries(aggregated, REGION_FACET, fixedWindow);

    expect(series[0]?.points[0]?.time).toEqual(new Date(fixedWindow.from));
  });
});
