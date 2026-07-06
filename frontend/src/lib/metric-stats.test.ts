import { describe, it, expect } from "vitest";
import { statTiles } from "./metric-stats";
import { makeDataPoint, makeMetric } from "@/test/factories";

const MODEL_FACET = { attributes: ["model"], label: "model" };

describe("statTiles", () => {
  it("uses the latest cumulative of a single series", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", cumulative: 1.2 }),
        makeDataPoint({ id: "b", timestamp: "2024-01-01T00:00:10Z", cumulative: 3.4 }),
      ],
    });
    expect(statTiles(metric)).toEqual([
      {
        key: "",
        label: "(no attributes)",
        colorIndex: 0,
        total: 3.4,
        totalCount: null,
        totalSum: null,
      },
    ]);
  });

  it("returns one tile per series in chart order without a facet", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "a", attributes: { model: "opus" }, cumulative: 1.0 }),
        makeDataPoint({ id: "b", attributes: { model: "haiku" }, cumulative: 0.5 }),
        makeDataPoint({
          id: "c",
          timestamp: "2024-01-01T00:00:10Z",
          attributes: { model: "opus" },
          cumulative: 2.0,
        }),
      ],
    });
    expect(statTiles(metric).map((t) => [t.label, t.total, t.colorIndex])).toEqual([
      ['model="opus"', 2.0, 0],
      ['model="haiku"', 0.5, 1],
    ]);
  });

  it("sums the latest cumulative of each raw series within a facet group", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "a", attributes: { model: "opus", tier: "a" }, cumulative: 1.0 }),
        makeDataPoint({ id: "b", attributes: { model: "opus", tier: "b" }, cumulative: 0.25 }),
        makeDataPoint({
          id: "c",
          timestamp: "2024-01-01T00:00:10Z",
          attributes: { model: "opus", tier: "a" },
          cumulative: 2.0,
        }),
      ],
    });
    expect(statTiles(metric, MODEL_FACET)).toEqual([
      {
        key: "opus",
        label: "opus",
        colorIndex: 0,
        total: 2.25,
        totalCount: null,
        totalSum: null,
      },
    ]);
  });

  it("sums countCumulative and sumCumulative within a facet group for distributions", () => {
    const metric = makeMetric({
      type: "Histogram",
      dataPoints: [
        makeDataPoint({
          id: "a",
          attributes: { model: "opus", tier: "a" },
          countCumulative: 480,
          sumCumulative: 3.1,
        }),
        makeDataPoint({
          id: "b",
          attributes: { model: "opus", tier: "b" },
          countCumulative: 20,
          sumCumulative: 0.4,
        }),
      ],
    });
    expect(statTiles(metric, MODEL_FACET)).toEqual([
      {
        key: "opus",
        label: "opus",
        colorIndex: 0,
        total: null,
        totalCount: 500,
        totalSum: 3.5,
      },
    ]);
  });

  it("falls back to the latest point that has a cumulative when newer points lack one", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", cumulative: 5.0 }),
        makeDataPoint({ id: "b", timestamp: "2024-01-01T00:00:10Z", cumulative: null }),
      ],
    });
    expect(statTiles(metric)[0]?.total).toBe(5.0);
  });

  it("picks the latest point by timestamp even when dataPoints are unordered", () => {
    // Nanosecond-only difference: Date.parse would see these as equal.
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00.000000002Z", cumulative: 9.0 }),
        makeDataPoint({ id: "b", timestamp: "2024-01-01T00:00:00.000000001Z", cumulative: 1.0 }),
      ],
    });
    expect(statTiles(metric)[0]?.total).toBe(9.0);
  });

  it("returns [] when no dataPoint carries a cumulative (Gauge / non-monotonic Sum)", () => {
    const metric = makeMetric({
      type: "Gauge",
      dataPoints: [makeDataPoint({ id: "a", value: 1 }), makeDataPoint({ id: "b", value: 2 })],
    });
    expect(statTiles(metric)).toEqual([]);
  });

  it("returns [] for empty dataPoints", () => {
    expect(statTiles(makeMetric())).toEqual([]);
  });
});
