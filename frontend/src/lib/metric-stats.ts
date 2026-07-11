import type { DataPoint } from "@/types/telemetry";
import type { MetricFacet } from "@/lib/metric-catalog";
import { type ChartTimeRange, filterDataPointsInRange } from "@/lib/chart-time-range";
import type { AggregateSeriesData } from "@/hooks/use-metric-aggregate-series";

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

export interface StatTile {
  key: string;
  label: string;
  // Position of this series in chart order (first appearance across ALL
  // dataPoints), so tile colors match the chart lines.
  colorIndex: number;
  total: number | null;
  totalCount: number | null;
  totalSum: number | null;
}

// Whether a metric's points carry the cumulative-family fields at all —
// monotonic Sum (`cumulative`) and distributions (`countCumulative`/
// `sumCumulative`) do; Gauge and non-monotonic Sum never populate any of
// them (see schema.graphql). This is a per-metric property (every point of
// a given metric agrees), so it's checked once against the metric's raw
// live-buffer points rather than the (possibly empty, for a narrow range)
// range-scoped points — a metric that's eligible but has no data in the
// selected window should render "no total" from empty math, not be
// misclassified as ineligible.
export function hasStatTileSignal(dataPoints: DataPoint[]): boolean {
  return dataPoints.some(
    (dp) => dp.cumulative != null || dp.countCumulative != null || dp.sumCumulative != null,
  );
}

interface StatTilePoint {
  value: number;
  count?: number | null;
  sum?: number | null;
}

interface StatTileGroup {
  key: string;
  label: string;
  colorIndex: number;
  points: StatTilePoint[];
}

// Sums per-group points into totals. Sum/Gauge-shaped groups sum `value`
// (already a per-window delta, whether from a raw DataPoint or a bucketed
// AggregatePoint — see storage.MetricAggregate's doc comment); distribution
// groups instead sum `count`/`sum`, since a distribution's `value` is a
// per-window MEAN (sum/count), and averaging averages is not a valid total.
function combineStatTileGroups(groups: StatTileGroup[], isDistribution: boolean): StatTile[] {
  const tiles = groups.map((g): StatTile => {
    if (isDistribution) {
      let totalCount: number | null = null;
      let totalSum: number | null = null;
      for (const p of g.points) {
        if (p.count != null) totalCount = (totalCount ?? 0) + p.count;
        if (p.sum != null) totalSum = (totalSum ?? 0) + p.sum;
      }
      return {
        key: g.key,
        label: g.label,
        colorIndex: g.colorIndex,
        total: null,
        totalCount,
        totalSum,
      };
    }
    let total: number | null = null;
    for (const p of g.points) total = (total ?? 0) + p.value;
    return {
      key: g.key,
      label: g.label,
      colorIndex: g.colorIndex,
      total,
      totalCount: null,
      totalSum: null,
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
  const rawOrder = facetGroupOrder(rangeDataPoints, facet);
  let nextIndex = rawOrder.size;
  return aggregatedSeries.map((s) => {
    const label = facetGroupLabel(s.groupValues) || "(no attributes)";
    const colorIndex = rawOrder.has(label) ? rawOrder.get(label)! : nextIndex++;
    const windowed = filterDataPointsInRange(s.points, range);
    return {
      key: label,
      label,
      colorIndex,
      points: windowed.map((p) => ({ value: p.value, count: p.count, sum: p.sum })),
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
    group.points.push({ value: dp.value, count: dp.count, sum: dp.sum });
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
      isDistribution: boolean;
      eligible: boolean;
    }
  | {
      kind: "raw";
      rangeDataPoints: DataPoint[];
      facet: MetricFacet | null;
      range: ChartTimeRange;
      isDistribution: boolean;
      eligible: boolean;
    };

// Range-scoped replacement for the old cumulative-based statTiles: totals now
// come from summing the SAME range-scoped data the chart renders (aggregate
// series when a facet is active, raw range points otherwise) rather than
// reading the backend's "since observing" running totals. `eligible` mirrors
// the original Gauge/non-monotonic-Sum exclusion — see hasStatTileSignal.
export function computeStatTiles(input: StatTilesInput): StatTile[] {
  if (!input.eligible) return [];
  const groups =
    input.kind === "aggregate"
      ? statTileGroupsFromAggregate(
          input.aggregatedSeries,
          input.rangeDataPoints,
          input.facet,
          input.range,
        )
      : statTileGroupsFromRawPoints(input.rangeDataPoints, input.facet, input.range);
  return combineStatTileGroups(groups, input.isDistribution);
}
