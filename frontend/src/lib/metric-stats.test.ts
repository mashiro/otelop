import { describe, it, expect } from "vitest";
import {
  computeStatTiles,
  facetGroupLabel,
  facetGroupOrder,
  hasTotalStatTileSignal,
  statTileGroupsFromAggregate,
  statTileGroupsFromRawPoints,
  type StatTilesInput,
} from "./metric-stats";
import { makeDataPoint, makeAggregatePoint, makeAggregateSeries } from "@/test/factories";

const MODEL_FACET = { attributes: ["model"], label: "model" };

describe("facetGroupLabel", () => {
  it("joins group values with a space, matching facetSeriesKey's display format", () => {
    expect(facetGroupLabel(["GET", "/api"])).toBe("GET /api");
  });

  it("renders a missing-attribute group (empty string from the server) as (unset)", () => {
    expect(facetGroupLabel([""])).toBe("(unset)");
  });

  it("renders only the missing component as (unset) in a multi-attribute group", () => {
    expect(facetGroupLabel(["GET", ""])).toBe("GET (unset)");
  });
});

describe("facetGroupOrder", () => {
  it("orders groups by first appearance across dataPoints", () => {
    const dataPoints = [
      makeDataPoint({ id: "a", attributes: { model: "haiku" } }),
      makeDataPoint({ id: "b", attributes: { model: "opus" } }),
      makeDataPoint({ id: "c", attributes: { model: "haiku" } }),
    ];

    const order = facetGroupOrder(dataPoints, MODEL_FACET);

    expect(order.get("haiku")).toBe(0);
    expect(order.get("opus")).toBe(1);
  });
});

describe("hasTotalStatTileSignal", () => {
  it("is true when any point carries cumulative", () => {
    expect(hasTotalStatTileSignal([makeDataPoint({ cumulative: 1 })])).toBe(true);
  });

  it("is true when any point carries countCumulative/sumCumulative (distributions)", () => {
    expect(hasTotalStatTileSignal([makeDataPoint({ countCumulative: 1, sumCumulative: 2 })])).toBe(
      true,
    );
  });

  it("is false for Gauge / non-monotonic Sum points (no cumulative family field)", () => {
    expect(hasTotalStatTileSignal([makeDataPoint({ value: 1 }), makeDataPoint({ value: 2 })])).toBe(
      false,
    );
  });

  it("is false for an empty metric", () => {
    expect(hasTotalStatTileSignal([])).toBe(false);
  });
});

function sumInput(overrides: Partial<StatTilesInput & { kind: "raw" }> = {}): StatTilesInput {
  return {
    kind: "raw",
    rangeDataPoints: [],
    facet: null,
    range: "all",
    mode: "total",
    includeLatestCount: false,
    ...overrides,
  };
}

describe("computeStatTiles — raw (facet=All) path", () => {
  it("sums per-series value deltas within the range, one tile per attribute combo", () => {
    const rangeDataPoints = [
      makeDataPoint({ id: "a", attributes: { model: "opus" }, value: 1.0 }),
      makeDataPoint({ id: "b", attributes: { model: "haiku" }, value: 0.5 }),
      makeDataPoint({
        id: "c",
        timestamp: "2024-01-01T00:00:10Z",
        attributes: { model: "opus" },
        value: 2.0,
      }),
    ];

    const tiles = computeStatTiles(sumInput({ rangeDataPoints }));

    expect(tiles.map((t) => [t.label, t.value, t.colorIndex])).toEqual([
      ['model="opus"', 3.0, 0],
      ['model="haiku"', 0.5, 1],
    ]);
  });

  it("groups by full attribute combination when facet is null, summing deltas per combo", () => {
    const rangeDataPoints = [
      makeDataPoint({ id: "a", attributes: { model: "opus", tier: "a" }, value: 1.0 }),
      makeDataPoint({ id: "b", attributes: { model: "opus", tier: "b" }, value: 0.25 }),
      makeDataPoint({
        id: "c",
        timestamp: "2024-01-01T00:00:10Z",
        attributes: { model: "opus", tier: "a" },
        value: 2.0,
      }),
    ];

    const tiles = computeStatTiles(sumInput({ rangeDataPoints }));

    expect(tiles).toHaveLength(2);
    const opusA = tiles.find((t) => t.label.includes('tier="a"'));
    expect(opusA?.value).toBe(3.0);
  });

  it("uses the latest value and count for distribution metrics", () => {
    const rangeDataPoints = [
      makeDataPoint({
        id: "b",
        timestamp: "2024-01-01T00:00:30Z",
        attributes: { model: "opus" },
        value: 2,
        count: 20,
      }),
      makeDataPoint({
        id: "a",
        timestamp: "2024-01-01T00:00:00Z",
        attributes: { model: "opus" },
        value: 1,
        count: 480,
      }),
    ];

    const tiles = computeStatTiles(
      sumInput({
        rangeDataPoints,
        facet: MODEL_FACET,
        mode: "latest",
        includeLatestCount: true,
      }),
    );

    expect(tiles).toEqual([
      {
        key: "opus",
        label: "opus",
        colorIndex: 0,
        value: 2,
        count: 20,
      },
    ]);
  });

  it("returns [] for an empty metric", () => {
    expect(computeStatTiles(sumInput())).toEqual([]);
  });

  it("excludes points outside a fixed range window (anchored on the max data timestamp)", () => {
    // The window is anchored on the max point's own timestamp, so a fixed
    // range never excludes every point — it only trims points further back
    // than rangeMs from that max, mirroring the chart's timeRangeDomain.
    const rangeDataPoints = [
      makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", value: 100 }),
      makeDataPoint({ id: "b", timestamp: "2024-01-01T00:10:00Z", value: 2 }),
    ];

    const tiles = computeStatTiles(sumInput({ rangeDataPoints, range: "1m" }));

    expect(tiles).toEqual([
      {
        key: "",
        label: "(no attributes)",
        colorIndex: 0,
        value: 2,
        count: null,
      },
    ]);
  });
});

describe("computeStatTiles — aggregate (facet active) path", () => {
  it("sums the fetched aggregate points' value per group for Sum metrics", () => {
    const aggregatedSeries = [
      makeAggregateSeries({
        groupValues: ["opus"],
        points: [
          makeAggregatePoint({ timestamp: "2024-01-01T00:00:00Z", value: 2 }),
          makeAggregatePoint({ timestamp: "2024-01-01T00:00:30Z", value: 3 }),
        ],
      }),
      makeAggregateSeries({
        groupValues: ["haiku"],
        points: [makeAggregatePoint({ timestamp: "2024-01-01T00:00:00Z", value: 1 })],
      }),
    ];
    const rangeDataPoints = [
      makeDataPoint({ id: "a", attributes: { model: "opus" } }),
      makeDataPoint({ id: "b", attributes: { model: "haiku" } }),
    ];

    const tiles = computeStatTiles({
      kind: "aggregate",
      aggregatedSeries,
      rangeDataPoints,
      facet: MODEL_FACET,
      range: "all",
      mode: "total",
      includeLatestCount: false,
    });

    expect(tiles).toEqual([
      { key: "opus", label: "opus", colorIndex: 0, value: 5, count: null },
      { key: "haiku", label: "haiku", colorIndex: 1, value: 1, count: null },
    ]);
  });

  it("uses the latest bucket value and count for distribution metrics", () => {
    const aggregatedSeries = [
      makeAggregateSeries({
        groupValues: ["opus"],
        points: [
          makeAggregatePoint({ timestamp: "2024-01-01T00:00:00Z", value: 10, count: 4, sum: 40 }),
          makeAggregatePoint({ timestamp: "2024-01-01T00:00:30Z", value: 20, count: 2, sum: 40 }),
        ],
      }),
    ];

    const tiles = computeStatTiles({
      kind: "aggregate",
      aggregatedSeries,
      rangeDataPoints: [makeDataPoint({ id: "a", attributes: { model: "opus" } })],
      facet: MODEL_FACET,
      range: "all",
      mode: "latest",
      includeLatestCount: true,
    });

    expect(tiles).toEqual([{ key: "opus", label: "opus", colorIndex: 0, value: 20, count: 2 }]);
  });

  it("assigns colorIndex from first-appearance order in the raw range points, matching the chart", () => {
    const aggregatedSeries = [
      makeAggregateSeries({ groupValues: ["haiku"], points: [makeAggregatePoint({ value: 1 })] }),
      makeAggregateSeries({ groupValues: ["opus"], points: [makeAggregatePoint({ value: 2 })] }),
    ];
    // Opus appears first in the raw buffer, even though the aggregate query
    // (alphabetical) returns haiku first.
    const rangeDataPoints = [
      makeDataPoint({ id: "a", attributes: { model: "opus" } }),
      makeDataPoint({ id: "b", attributes: { model: "haiku" } }),
    ];

    const groups = statTileGroupsFromAggregate(
      aggregatedSeries,
      rangeDataPoints,
      MODEL_FACET,
      "all",
    );

    expect(groups.find((g) => g.key === "opus")?.colorIndex).toBe(0);
    expect(groups.find((g) => g.key === "haiku")?.colorIndex).toBe(1);
  });

  it("excludes aggregate points outside the selected range window", () => {
    const aggregatedSeries = [
      makeAggregateSeries({
        groupValues: ["opus"],
        points: [
          makeAggregatePoint({ timestamp: "2024-01-01T00:00:00Z", value: 100 }),
          makeAggregatePoint({ timestamp: "2024-01-01T00:10:00Z", value: 5 }),
        ],
      }),
    ];

    const groups = statTileGroupsFromAggregate(
      aggregatedSeries,
      [makeDataPoint({ id: "a", attributes: { model: "opus" } })],
      MODEL_FACET,
      "1m",
    );

    expect(groups[0]?.points).toEqual([
      { timestamp: "2024-01-01T00:10:00Z", value: 5, count: null },
    ]);
  });
});

describe("statTileGroupsFromRawPoints", () => {
  it("labels an attribute-less group '(no attributes)'", () => {
    const groups = statTileGroupsFromRawPoints([makeDataPoint({ id: "a", value: 1 })], null, "all");

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "", label: "(no attributes)", colorIndex: 0 });
    expect(groups[0]?.points.map((p) => p.value)).toEqual([1]);
  });
});
