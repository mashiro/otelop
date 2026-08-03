import { describe, expect, it } from "vite-plus/test";
import { makeDataPoint } from "@/test/factories";
import { bucketRawMetricPoints, chartTimeForAggregateTimestamp } from "./metric-chart-series";

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
