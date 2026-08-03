import { describe, it, expect } from "vite-plus/test";
import {
  computeStatTiles,
  facetGroupLabel,
  hasIncreaseStatTileSignal,
  statTileGroupsFromAggregate,
  statTileGroupsFromRawPoints,
  type StatTilesInput,
} from "./metric-stats";
import { makeDataPoint, makeAggregatePoint, makeAggregateSeries } from "@/test/factories";
import { parseEpochNs } from "@/lib/normalize";
import {
  facetGroupColorIdentity,
  facetGroupColorIndexes,
  seriesColorIndexes,
} from "@/lib/metric-series-colors";

const MODEL_FACET = { attributes: ["model"], label: "model" };
const liveWindow = (range: "1m" | "all") => ({ mode: "live" as const, range });

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

describe("metric series colors", () => {
  it("keeps raw series colors stable when response order changes", () => {
    const firstWindow = statTileGroupsFromRawPoints(
      [
        makeDataPoint({ id: "a", attributes: { model: "opus" } }),
        makeDataPoint({ id: "b", attributes: { model: "haiku" } }),
      ],
      null,
      liveWindow("all"),
    );
    const shiftedWindow = statTileGroupsFromRawPoints(
      [
        makeDataPoint({ id: "c", attributes: { model: "haiku" } }),
        makeDataPoint({ id: "d", attributes: { model: "opus" } }),
      ],
      null,
      liveWindow("all"),
    );

    expect(firstWindow.find((group) => group.key === 'model="opus"')?.colorIndex).toBe(
      shiftedWindow.find((group) => group.key === 'model="opus"')?.colorIndex,
    );
  });

  it("includes facet identity and raw group values in the stable color", () => {
    const regionFacet = { attributes: ["region"], label: "region" };
    expect(facetGroupColorIdentity(MODEL_FACET, ["opus"])).not.toBe(
      facetGroupColorIdentity(regionFacet, ["opus"]),
    );
    expect(facetGroupColorIdentity(MODEL_FACET, [""])).toBe(
      facetGroupColorIdentity(MODEL_FACET, ["(unset)"]),
    );
  });

  it("uses distinct colors for every token type in the reported seven-series case", () => {
    const tokenTypes = [
      "cache_write_input",
      "cached_input",
      "input",
      "non_cached_input",
      "output",
      "reasoning_output",
      "total",
    ];
    const colors = facetGroupColorIndexes(
      { attributes: ["token_type"], label: "token_type" },
      tokenTypes.map((value) => [value]),
    );

    expect(new Set(colors).size).toBe(tokenTypes.length);
  });
});

describe("hasIncreaseStatTileSignal", () => {
  it("is true when any point carries cumulative", () => {
    expect(hasIncreaseStatTileSignal([makeDataPoint({ cumulative: 1 })])).toBe(true);
  });

  it("is true when any point carries countCumulative/sumCumulative (distributions)", () => {
    expect(
      hasIncreaseStatTileSignal([makeDataPoint({ countCumulative: 1, sumCumulative: 2 })]),
    ).toBe(true);
  });

  it("is false for Gauge / non-monotonic Sum points (no cumulative family field)", () => {
    expect(
      hasIncreaseStatTileSignal([makeDataPoint({ value: 1 }), makeDataPoint({ value: 2 })]),
    ).toBe(false);
  });

  it("is false for an empty metric", () => {
    expect(hasIncreaseStatTileSignal([])).toBe(false);
  });
});

function increaseInput(overrides: Partial<StatTilesInput & { kind: "raw" }> = {}): StatTilesInput {
  return {
    kind: "raw",
    rangeDataPoints: [],
    facet: null,
    window: liveWindow("all"),
    mode: "increase",
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

    const tiles = computeStatTiles(increaseInput({ rangeDataPoints }));

    const colors = seriesColorIndexes(['model="opus"', 'model="haiku"']);
    expect(tiles.map((t) => [t.label, t.value, t.colorIndex])).toEqual([
      ['model="opus"', 3.0, colors[0]],
      ['model="haiku"', 0.5, colors[1]],
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

    const tiles = computeStatTiles(increaseInput({ rangeDataPoints }));

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
      increaseInput({
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
        colorIndex: facetGroupColorIndexes(MODEL_FACET, [["opus"]])[0],
        value: 2,
        count: 20,
      },
    ]);
  });

  it("returns [] for an empty metric", () => {
    expect(computeStatTiles(increaseInput())).toEqual([]);
  });

  it("excludes points outside a fixed range window (anchored on the max data timestamp)", () => {
    // The window is anchored on the max point's own timestamp, so a fixed
    // range never excludes every point — it only trims points further back
    // than rangeMs from that max, mirroring the chart's timeRangeDomain.
    const rangeDataPoints = [
      makeDataPoint({ id: "a", timestamp: "2024-01-01T00:00:00Z", value: 100 }),
      makeDataPoint({ id: "b", timestamp: "2024-01-01T00:10:00Z", value: 2 }),
    ];

    const tiles = computeStatTiles(increaseInput({ rangeDataPoints, window: liveWindow("1m") }));

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
    const tiles = computeStatTiles({
      kind: "aggregate",
      aggregatedSeries,
      facet: MODEL_FACET,
      window: liveWindow("all"),
      mode: "increase",
      includeLatestCount: false,
    });

    const colors = facetGroupColorIndexes(MODEL_FACET, [["opus"], ["haiku"]]);
    expect(tiles).toEqual([
      {
        key: "opus",
        label: "opus",
        colorIndex: colors[0],
        value: 5,
        count: null,
      },
      {
        key: "haiku",
        label: "haiku",
        colorIndex: colors[1],
        value: 1,
        count: null,
      },
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
      facet: MODEL_FACET,
      window: liveWindow("all"),
      mode: "latest",
      includeLatestCount: true,
    });

    expect(tiles).toEqual([
      {
        key: "opus",
        label: "opus",
        colorIndex: facetGroupColorIndexes(MODEL_FACET, [["opus"]])[0],
        value: 20,
        count: 2,
      },
    ]);
  });

  it("assigns stable colors independent of aggregate and raw point order", () => {
    const aggregatedSeries = [
      makeAggregateSeries({ groupValues: ["haiku"], points: [makeAggregatePoint({ value: 1 })] }),
      makeAggregateSeries({ groupValues: ["opus"], points: [makeAggregatePoint({ value: 2 })] }),
    ];
    const groups = statTileGroupsFromAggregate(aggregatedSeries, MODEL_FACET, liveWindow("all"));
    const reversed = statTileGroupsFromAggregate(
      aggregatedSeries.toReversed(),
      MODEL_FACET,
      liveWindow("all"),
    );

    expect(groups.find((g) => g.key === "opus")?.colorIndex).toBe(
      reversed.find((g) => g.key === "opus")?.colorIndex,
    );
    expect(groups.find((g) => g.key === "haiku")?.colorIndex).toBe(
      reversed.find((g) => g.key === "haiku")?.colorIndex,
    );
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

    const groups = statTileGroupsFromAggregate(aggregatedSeries, MODEL_FACET, liveWindow("1m"));

    expect(groups[0]?.points).toEqual([
      {
        timestamp: "2024-01-01T00:10:00Z",
        epochNs: parseEpochNs("2024-01-01T00:10:00Z"),
        seriesKey: "opus",
        value: 5,
        count: null,
      },
    ]);
  });
});

describe("statTileGroupsFromRawPoints", () => {
  it("labels an attribute-less group '(no attributes)'", () => {
    const groups = statTileGroupsFromRawPoints(
      [makeDataPoint({ id: "a", value: 1 })],
      null,
      liveWindow("all"),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "", label: "(no attributes)", colorIndex: 0 });
    expect(groups[0]?.points.map((p) => p.value)).toEqual([1]);
  });
});
