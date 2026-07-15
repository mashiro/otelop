import type { DataPoint } from "@/types/telemetry";
import type { MetricFacet } from "@/lib/metric-catalog";
import { type ChartTimeRange, filterDataPointsInRange } from "@/lib/chart-time-range";
import type { AggregateSeriesData } from "@/hooks/use-metric-aggregate-series";
import { Temporal } from "temporal-polyfill";

/** Serialize attributes to a stable string key for grouping. */
export function attrKey(attrs: Record<string, unknown>): string {
  const entries = Object.entries(attrs).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
}

/** Render a single attribute value (already safely narrowed from unknown). */
export function formatAttrValue(v: unknown): string {
  if (v === undefined || v === null) return "(unset)";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  return JSON.stringify(v);
}

/**
 * Series key for the given facet — the same grouping the chart draws lines by,
 * so summary tiles and chart series stay aligned (order, colors, membership).
 */
export function facetSeriesKey(attrs: Record<string, unknown>, facet?: MetricFacet | null): string {
  if (facet) return facet.attributes.map((a) => formatAttrValue(attrs[a])).join(" ");
  return attrKey(attrs);
}

/**
 * Display label for a server-aggregated facet group (see
 * hooks/use-metric-aggregate-series.ts): joins the group's attribute values
 * the same way facetSeriesKey does, so a group missing the facet's attribute
 * entirely reads "(unset)" — matching formatAttrValue(undefined) — instead
 * of the empty string metric_series.attributes->>key extraction produces for
 * a genuinely missing key.
 */
export function facetGroupLabel(groupValues: string[]): string {
  return groupValues.map((v) => (v === "" ? "(unset)" : v)).join(" ");
}

/**
 * First-appearance order of each facet group across metric.dataPoints — the
 * same ordering statTiles derives its colorIndex from. metric-chart.tsx's
 * server-aggregated path needs this too: the aggregate query orders its
 * result alphabetically by group value (see internal/storage's
 * MetricAggregate), which does NOT generally match first-appearance order,
 * so using it directly for color assignment would desync the chart's line
 * colors from the stat tiles above it.
 */
export function facetGroupOrder(
  dataPoints: DataPoint[],
  facet?: MetricFacet | null,
): Map<string, number> {
  const order = new Map<string, number>();
  for (const dp of dataPoints) {
    const key = facetSeriesKey(dp.attributes, facet);
    if (!order.has(key)) order.set(key, order.size);
  }
  return order;
}

/**
 * Resolves each server-aggregated facet group's display label and chart
 * colorIndex, in aggregatedSeries order — shared by metric-chart.tsx's
 * facet-active line series and statTileGroupsFromAggregate below, so the
 * chart and the stat tiles above it can't desync on color assignment. Colors
 * come from first-appearance order in rangeDataPoints (the raw live/fetched
 * buffer), not the aggregate query's own alphabetical group ordering (see
 * facetGroupOrder); a group present server-side but absent from the raw
 * buffer falls back to an index appended after every known one.
 */
export function resolveFacetGroupColorIndex(
  aggregatedSeries: AggregateSeriesData[],
  rangeDataPoints: DataPoint[],
  facet: MetricFacet,
): { label: string; colorIndex: number }[] {
  const rawOrder = facetGroupOrder(rangeDataPoints, facet);
  let nextIndex = rawOrder.size;
  return aggregatedSeries.map((s) => {
    const label = facetGroupLabel(s.groupValues) || "(no attributes)";
    const colorIndex = rawOrder.has(label) ? rawOrder.get(label)! : nextIndex++;
    return { label, colorIndex };
  });
}

export interface StatTile {
  key: string;
  label: string;
  // Position of this series in chart order (first appearance across ALL
  // dataPoints), so tile colors match the chart lines.
  colorIndex: number;
  value: number | null;
  count: number | null;
}

// Whether a metric's points carry the cumulative-family fields at all —
// monotonic Sum (`cumulative`) and distributions (`countCumulative`/
// `sumCumulative`) do; Gauge and non-monotonic Sum never populate any of
// them (see schema.graphql). This is a per-metric property (every point of
// a given metric agrees), so it's checked once against the metric's raw
// live-buffer points rather than the (possibly empty, for a narrow range)
// range-scoped points — a metric that's eligible but has no data in the
// selected window should render "no increase" from empty math, not be
// misclassified as ineligible.
export function hasIncreaseStatTileSignal(dataPoints: DataPoint[]): boolean {
  return dataPoints.some(
    (dp) => dp.cumulative != null || dp.countCumulative != null || dp.sumCumulative != null,
  );
}

interface StatTilePoint {
  timestamp: string;
  value: number;
  count?: number | null;
}

interface StatTileGroup {
  key: string;
  label: string;
  colorIndex: number;
  points: StatTilePoint[];
}

export type StatTileMode = "increase" | "latest";

function latestPoint(points: StatTilePoint[]): StatTilePoint | undefined {
  let latest: StatTilePoint | undefined;
  let latestInstant: Temporal.Instant | undefined;
  for (const point of points) {
    const instant = Temporal.Instant.from(point.timestamp);
    if (!latestInstant || Temporal.Instant.compare(instant, latestInstant) > 0) {
      latest = point;
      latestInstant = instant;
    }
  }
  return latest;
}

// Monotonic sums show the sum of the selected range's deltas. Gauges and
// distributions show the last observation in that same range, matching the
// chart's right edge instead of inventing an increase for a snapshot or mean.
function combineStatTileGroups(
  groups: StatTileGroup[],
  mode: StatTileMode,
  includeLatestCount: boolean,
): StatTile[] {
  const tiles = groups.map((g): StatTile => {
    if (mode === "latest") {
      const latest = latestPoint(g.points);
      return {
        key: g.key,
        label: g.label,
        colorIndex: g.colorIndex,
        value: latest?.value ?? null,
        count: includeLatestCount ? (latest?.count ?? null) : null,
      };
    }
    let value: number | null = null;
    for (const p of g.points) value = (value ?? 0) + p.value;
    return {
      key: g.key,
      label: g.label,
      colorIndex: g.colorIndex,
      value,
      count: null,
    };
  });
  return tiles.sort((a, b) => a.colorIndex - b.colorIndex);
}

// Builds one group per server-aggregated facet series (see
// hooks/use-metric-aggregate-series.ts) — the facet-active path, mirroring
// exactly what the chart renders for the same facet/range. rangeDataPoints
// (the range-scoped raw buffer, unfiltered by the visible window) supplies
// the same first-appearance color ordering the chart's ChartInner derives
// via facetGroupOrder, so tile colors stay aligned with the chart's lines
// even before every group has landed server-side.
export function statTileGroupsFromAggregate(
  aggregatedSeries: AggregateSeriesData[],
  rangeDataPoints: DataPoint[],
  facet: MetricFacet,
  range: ChartTimeRange,
): StatTileGroup[] {
  const resolved = resolveFacetGroupColorIndex(aggregatedSeries, rangeDataPoints, facet);
  return aggregatedSeries.map((s, i) => {
    const { label, colorIndex } = resolved[i]!;
    const windowed = filterDataPointsInRange(s.points, range);
    return {
      key: label,
      label,
      colorIndex,
      points: windowed.map((p) => ({
        timestamp: p.timestamp,
        value: p.value,
        count: p.count,
      })),
    };
  });
}

// Builds one group per full attribute combination from range-scoped raw
// points — the facet="All" path, mirroring the chart's raw (non-aggregated)
// client-side grouping for the same range.
export function statTileGroupsFromRawPoints(
  rangeDataPoints: DataPoint[],
  facet: MetricFacet | null,
  range: ChartTimeRange,
): StatTileGroup[] {
  const order = facetGroupOrder(rangeDataPoints, facet);
  const windowed = filterDataPointsInRange(rangeDataPoints, range);
  const groups = new Map<string, StatTileGroup>();
  for (const dp of windowed) {
    const key = facetSeriesKey(dp.attributes, facet);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: key || "(no attributes)", colorIndex: order.get(key) ?? 0, points: [] };
      groups.set(key, group);
    }
    group.points.push({ timestamp: dp.timestamp, value: dp.value, count: dp.count });
  }
  return [...groups.values()];
}

// Discriminated input for computeStatTiles: "aggregate" when a facet is
// active (server-summed series, the fix for the zigzag-sum bug — see
// use-metric-aggregate-series.ts), "raw" for the facet="All" view (grouped
// client-side by full attribute combination). Both branches flow through the
// same combineStatTileGroups math once reduced to StatTileGroup[].
export type StatTilesInput =
  | {
      kind: "aggregate";
      aggregatedSeries: AggregateSeriesData[];
      rangeDataPoints: DataPoint[];
      facet: MetricFacet;
      range: ChartTimeRange;
      mode: StatTileMode;
      includeLatestCount: boolean;
    }
  | {
      kind: "raw";
      rangeDataPoints: DataPoint[];
      facet: MetricFacet | null;
      range: ChartTimeRange;
      mode: StatTileMode;
      includeLatestCount: boolean;
    };

// Range-scoped replacement for the old cumulative-based statTiles. Both increase
// and latest modes read the SAME range-scoped data the chart renders
// (aggregate series when a facet is active, raw range points otherwise).
export function computeStatTiles(input: StatTilesInput): StatTile[] {
  const groups =
    input.kind === "aggregate"
      ? statTileGroupsFromAggregate(
          input.aggregatedSeries,
          input.rangeDataPoints,
          input.facet,
          input.range,
        )
      : statTileGroupsFromRawPoints(input.rangeDataPoints, input.facet, input.range);
  return combineStatTileGroups(groups, input.mode, input.includeLatestCount);
}
