import { describe, it, expect, vi } from "vite-plus/test";
import { Temporal } from "temporal-polyfill";
import {
  CHART_TIME_RANGES,
  DEFAULT_CHART_TIME_RANGE,
  rangeToMs,
  rangeToFrom,
  timeRangeDomain,
  filterPointsInDomain,
  filterDataPointsInRange,
  bucketSecondsForRange,
  isChartTimeRange,
  type ChartTimeRange,
} from "./chart-time-range";

describe("CHART_TIME_RANGES", () => {
  it("lists 1m, 5m, 15m, 30m, 1h, 3h, 6h, 12h, 24h, all with an All label", () => {
    expect(CHART_TIME_RANGES).toEqual([
      { value: "1m", label: "1m" },
      { value: "5m", label: "5m" },
      { value: "15m", label: "15m" },
      { value: "30m", label: "30m" },
      { value: "1h", label: "1h" },
      { value: "3h", label: "3h" },
      { value: "6h", label: "6h" },
      { value: "12h", label: "12h" },
      { value: "24h", label: "24h" },
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
    expect(rangeToMs("3h")).toBe(3 * 60 * 60_000);
    expect(rangeToMs("6h")).toBe(6 * 60 * 60_000);
    expect(rangeToMs("12h")).toBe(12 * 60 * 60_000);
    expect(rangeToMs("24h")).toBe(24 * 60 * 60_000);
  });
});

describe("rangeToFrom", () => {
  it("returns undefined for 'all'", () => {
    expect(rangeToFrom("all")).toBeUndefined();
  });

  it.each<ChartTimeRange>(["1m", "5m", "15m", "30m", "1h", "3h", "6h", "12h", "24h"])(
    "subtracts the %s window from now",
    (range) => {
      const before = Temporal.Now.instant();

      const from = rangeToFrom(range);

      const fromInstant = Temporal.Instant.from(from!);
      const deltaMs = before.since(fromInstant).total("milliseconds");
      const rangeMs = rangeToMs(range)!;
      expect(deltaMs).toBeGreaterThan(rangeMs - 1000);
      expect(deltaMs).toBeLessThan(rangeMs + 1000);
    },
  );
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

  it.each<ChartTimeRange>(["1m", "15m", "6h", "24h"])(
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
    // 3h / 150 = 72s.
    expect(bucketSecondsForRange("3h")).toBe(72);
    // 6h / 150 = 144s.
    expect(bucketSecondsForRange("6h")).toBe(144);
    // 12h / 150 = 288s.
    expect(bucketSecondsForRange("12h")).toBe(288);
    // 24h / 150 = 576s.
    expect(bucketSecondsForRange("24h")).toBe(576);
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

describe("DEFAULT_CHART_TIME_RANGE", () => {
  it("is 1h, and is a valid CHART_TIME_RANGES entry", () => {
    expect(DEFAULT_CHART_TIME_RANGE).toBe("1h");
    expect(CHART_TIME_RANGES.some((r) => r.value === DEFAULT_CHART_TIME_RANGE)).toBe(true);
  });
});

describe("isChartTimeRange", () => {
  it("accepts every CHART_TIME_RANGES value", () => {
    for (const { value } of CHART_TIME_RANGES) {
      expect(isChartTimeRange(value)).toBe(true);
    }
  });

  it("rejects unknown or malformed values", () => {
    expect(isChartTimeRange("7d")).toBe(false);
    expect(isChartTimeRange("")).toBe(false);
    expect(isChartTimeRange("1H")).toBe(false);
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

  it("parses each point's timestamp exactly once (single pass, not a max-finding pass plus a filter pass)", () => {
    const points = [
      { timestamp: "2024-01-01T00:00:00Z" },
      { timestamp: "2024-01-01T00:10:00Z" },
      { timestamp: "2024-01-01T00:20:00Z" },
    ];
    const getTimestamp = vi.fn((p: (typeof points)[number]) => p.timestamp);

    filterDataPointsInRange(points, "5m", getTimestamp);

    expect(getTimestamp).toHaveBeenCalledTimes(points.length);
  });

  describe("with an explicit getTimestamp selector", () => {
    // Trace rows carry their instant under `startTime`, not `timestamp` (see
    // types/telemetry.ts) — the trace/log list's live-tail display filter
    // (stores/filters.ts) passes a selector rather than reshaping every row.
    it("anchors the window on the max value the selector returns", () => {
      const inWindow = { startTime: "2024-01-01T00:19:00Z" };
      const outOfWindow = { startTime: "2024-01-01T00:00:00Z" };
      const max = { startTime: "2024-01-01T00:20:00Z" };

      expect(
        filterDataPointsInRange([outOfWindow, inWindow, max], "5m", (p) => p.startTime),
      ).toEqual([inWindow, max]);
    });

    it("returns everything unfiltered for 'all'", () => {
      const points = [{ startTime: "2024-01-01T00:00:00Z" }, { startTime: "2024-01-01T00:10:00Z" }];

      expect(filterDataPointsInRange(points, "all", (p) => p.startTime)).toEqual(points);
    });
  });
});
