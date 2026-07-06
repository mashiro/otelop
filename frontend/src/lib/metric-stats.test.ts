import { describe, it, expect } from "vitest";
import { cumulativeTiles } from "./metric-stats";
import { makeDataPoint, makeMetric } from "@/test/factories";

const MODEL_FACET = { attributes: ["model"], label: "model" };

describe("cumulativeTiles", () => {
  it("returns the latest cumulative of a single series, ignoring older points", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", cumulative: 1.2 }),
        makeDataPoint({ id: "b", timestamp: "2024-01-01T00:00:10Z", cumulative: 3.4 }),
      ],
    });
    expect(cumulativeTiles(metric)).toEqual([
      {
        key: "",
        label: "(no attributes)",
        colorIndex: 0,
        cumulative: 3.4,
        countCumulative: null,
        sumCumulative: null,
      },
    ]);
  });

  it("returns one tile per series in first-appearance order without a facet", () => {
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
    const tiles = cumulativeTiles(metric);
    expect(tiles.map((t) => [t.label, t.cumulative, t.colorIndex])).toEqual([
      ['model="opus"', 2.0, 0],
      ['model="haiku"', 0.5, 1],
    ]);
  });

  it("labels tiles with the raw facet value when a facet is active", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "a", attributes: { model: "opus" }, cumulative: 1.0 }),
        makeDataPoint({ id: "b", attributes: { model: "haiku" }, cumulative: 0.5 }),
      ],
    });
    expect(cumulativeTiles(metric, MODEL_FACET).map((t) => t.label)).toEqual(["opus", "haiku"]);
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
    expect(cumulativeTiles(metric, MODEL_FACET)).toEqual([
      {
        key: "opus",
        label: "opus",
        colorIndex: 0,
        cumulative: 2.25,
        countCumulative: null,
        sumCumulative: null,
      },
    ]);
  });

  it("labels a missing facet attribute as (unset)", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "a", attributes: { other: "x" }, cumulative: 1.0 })],
    });
    expect(cumulativeTiles(metric, MODEL_FACET)[0]?.label).toBe("(unset)");
  });

  it("keeps colorIndex aligned with chart series order when some series lack cumulative", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "a", attributes: { model: "opus" } }),
        makeDataPoint({ id: "b", attributes: { model: "haiku" }, cumulative: 0.5 }),
      ],
    });
    const tiles = cumulativeTiles(metric);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.colorIndex).toBe(1);
  });

  it("falls back to the latest point that has a cumulative when newer points lack one", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", cumulative: 5.0 }),
        makeDataPoint({ id: "b", timestamp: "2024-01-01T00:00:10Z", cumulative: null }),
      ],
    });
    expect(cumulativeTiles(metric)[0]?.cumulative).toBe(5.0);
  });

  it("returns [] for metrics without any cumulative (Gauge / delta inputs)", () => {
    const metric = makeMetric({
      type: "Gauge",
      dataPoints: [
        makeDataPoint({ id: "a", value: 1 }),
        makeDataPoint({ id: "b", value: 2, count: 3, sum: 6 }),
      ],
    });
    expect(cumulativeTiles(metric)).toEqual([]);
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
    expect(cumulativeTiles(metric, MODEL_FACET)).toEqual([
      {
        key: "opus",
        label: "opus",
        colorIndex: 0,
        cumulative: null,
        countCumulative: 500,
        sumCumulative: 3.5,
      },
    ]);
  });

  it("picks the latest point by timestamp even when dataPoints are unordered", () => {
    // Nanosecond-only difference: Date.parse would see these as equal.
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00.000000002Z", cumulative: 9.0 }),
        makeDataPoint({ id: "b", timestamp: "2024-01-01T00:00:00.000000001Z", cumulative: 1.0 }),
      ],
    });
    expect(cumulativeTiles(metric)[0]?.cumulative).toBe(9.0);
  });

  it("returns [] for empty dataPoints", () => {
    expect(cumulativeTiles(makeMetric())).toEqual([]);
  });
});
