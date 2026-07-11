import { describe, it, expect } from "vitest";
import {
  CHART_TIME_RANGES,
  rangeToMs,
  timeRangeDomain,
  filterPointsInDomain,
  filterDataPointsInRange,
  bucketSecondsForRange,
  type ChartTimeRange,
} from "./chart-time-range";

describe("CHART_TIME_RANGES", () => {
  it("lists 1m, 5m, 15m, 30m, 1h, all with an All label", () => {
    expect(CHART_TIME_RANGES).toEqual([
      { value: "1m", label: "1m" },
      { value: "5m", label: "5m" },
      { value: "15m", label: "15m" },
      { value: "30m", label: "30m" },
      { value: "1h", label: "1h" },
      { value: "all", label: "All" },
    ]);
  });
});

describe("rangeToMs", () => {
  it("returns null for all", () => {
    expect(rangeToMs("all")).toBeNull();
  });

  it("converts minutes to milliseconds", () => {
    expect(rangeToMs("1m")).toBe(60_000);
    expect(rangeToMs("5m")).toBe(5 * 60_000);
    expect(rangeToMs("15m")).toBe(15 * 60_000);
    expect(rangeToMs("30m")).toBe(30 * 60_000);
    expect(rangeToMs("1h")).toBe(60 * 60_000);
  });
});

describe("timeRangeDomain", () => {
  it("returns null when there are no points", () => {
    expect(timeRangeDomain([], "all")).toBeNull();
  });

  it("fits min/max for all", () => {
    const points = [
      { time: new Date("2024-01-01T00:00:00Z") },
      { time: new Date("2024-01-01T00:10:00Z") },
      { time: new Date("2024-01-01T00:05:00Z") },
    ];

    const domain = timeRangeDomain(points, "all");

    expect(domain).toEqual([new Date("2024-01-01T00:00:00Z"), new Date("2024-01-01T00:10:00Z")]);
  });

  it("anchors on the max data timestamp, not wall-clock, and ignores min", () => {
    const points = [
      { time: new Date("2024-01-01T00:00:00Z") },
      { time: new Date("2024-01-01T00:20:00Z") },
    ];

    const domain = timeRangeDomain(points, "5m");

    expect(domain).toEqual([new Date("2024-01-01T00:15:00Z"), new Date("2024-01-01T00:20:00Z")]);
  });

  it.each<ChartTimeRange>(["1m", "15m"])(
    "computes a %s window ending at the max timestamp",
    (range) => {
      const max = new Date("2024-01-01T00:30:00Z");
      const points = [{ time: new Date("2024-01-01T00:00:00Z") }, { time: max }];

      const domain = timeRangeDomain(points, range);

      expect(domain?.[1]).toEqual(max);
      expect(domain?.[0]).toEqual(new Date(max.getTime() - rangeToMs(range)!));
    },
  );
});

describe("bucketSecondsForRange", () => {
  it("aims for ~150 buckets across a fixed range", () => {
    // 1h / 150 = 24s.
    expect(bucketSecondsForRange("1h")).toBe(24);
    // 5m / 150 = 2s.
    expect(bucketSecondsForRange("5m")).toBe(2);
  });

  it("clamps to a minimum of 1 second", () => {
    expect(bucketSecondsForRange("1m")).toBeGreaterThanOrEqual(1);
  });

  it("returns null for the all range (server auto-sizes against the real data extent)", () => {
    expect(bucketSecondsForRange("all")).toBeNull();
  });
});

describe("filterPointsInDomain", () => {
  const domain: [Date, Date] = [new Date("2024-01-01T00:05:00Z"), new Date("2024-01-01T00:10:00Z")];

  it("includes points on the domain boundary (inclusive)", () => {
    const points = [{ time: domain[0] }, { time: domain[1] }];

    expect(filterPointsInDomain(points, domain)).toEqual(points);
  });

  it("excludes points outside the domain", () => {
    const before = { time: new Date("2024-01-01T00:00:00Z") };
    const inside = { time: new Date("2024-01-01T00:07:00Z") };
    const after = { time: new Date("2024-01-01T00:15:00Z") };

    expect(filterPointsInDomain([before, inside, after], domain)).toEqual([inside]);
  });

  it("preserves extra fields on the filtered items", () => {
    const points = [{ time: new Date("2024-01-01T00:07:00Z"), value: 42 }];

    expect(filterPointsInDomain(points, domain)).toEqual([{ time: points[0]!.time, value: 42 }]);
  });
});

describe("filterDataPointsInRange", () => {
  it("returns everything unfiltered for 'all'", () => {
    const points = [{ timestamp: "2024-01-01T00:00:00Z" }, { timestamp: "2024-01-01T00:10:00Z" }];

    expect(filterDataPointsInRange(points, "all")).toEqual(points);
  });

  it("returns [] unchanged for an empty input", () => {
    expect(filterDataPointsInRange([], "5m")).toEqual([]);
  });

  it("anchors the window on the max timestamp, not wall-clock", () => {
    const inWindow = { timestamp: "2024-01-01T00:19:00Z" };
    const outOfWindow = { timestamp: "2024-01-01T00:00:00Z" };
    const max = { timestamp: "2024-01-01T00:20:00Z" };

    expect(filterDataPointsInRange([outOfWindow, inWindow, max], "5m")).toEqual([inWindow, max]);
  });

  it("includes a point exactly at the window boundary", () => {
    const max = { timestamp: "2024-01-01T00:05:00Z" };
    const boundary = { timestamp: "2024-01-01T00:00:00Z" };

    expect(filterDataPointsInRange([boundary, max], "5m")).toEqual([boundary, max]);
  });

  it("preserves extra fields on the filtered items", () => {
    const points = [{ timestamp: "2024-01-01T00:00:00Z", value: 42 }];

    expect(filterDataPointsInRange(points, "all")).toEqual(points);
  });
});
