import type { DataPoint } from "@/types/telemetry";
import type { MetricFacet } from "@/lib/metric-catalog";
import { type ChartTimeRange, filterDataPointsInRange } from "@/lib/chart-time-range";
import type { AggregateSeriesData } from "@/hooks/use-metric-aggregate-series";
import { parseEpochNs } from "@/lib/normalize";
import { facetGroupColorIndexes, seriesColorIndexes } from "@/lib/metric-series-colors";

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
 * Resolves each server-aggregated facet group's display label and chart
 * colorIndex, in aggregatedSeries order — shared by metric-chart.tsx's
 * facet-active line series and statTileGroupsFromAggregate below. The color
 * is derived only from the facet identity and group values, so moving the
 * time window cannot recolor a group when response membership/order changes.
 */
export function resolveFacetGroupColorIndex(
  aggregatedSeries: AggregateSeriesData[],
  facet: MetricFacet,
): { label: string; colorIndex: number }[] {
  const colorIndexes = facetGroupColorIndexes(
    facet,
    aggregatedSeries.map((series) => series.groupValues),
  );
  return aggregatedSeries.map((s, index) => {
    const label = facetGroupLabel(s.groupValues) || "(no attributes)";
    return { label, colorIndex: colorIndexes[index]! };
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
  epochNs: bigint;
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
  for (const point of points) {
    if (!latest || point.epochNs > latest.epochNs) {
      latest = point;
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
  return tiles;
}

// Builds one group per server-aggregated facet series (see
// hooks/use-metric-aggregate-series.ts) — the facet-active path, mirroring
// exactly what the chart renders for the same facet/range. Both surfaces use
// the same identity-derived color, independent of the selected time window.
export function statTileGroupsFromAggregate(
  aggregatedSeries: AggregateSeriesData[],
  facet: MetricFacet,
  range: ChartTimeRange,
): StatTileGroup[] {
  const resolved = resolveFacetGroupColorIndex(aggregatedSeries, facet);
  return aggregatedSeries.map((s, i) => {
    const { label, colorIndex } = resolved[i]!;
    // AggregatePointData is an ephemeral server-fetch result (not a store
    // view model — see hooks/use-metric-aggregate-series.ts), so it has no
    // pre-parsed epoch field; parseEpochNs is called explicitly here, the
    // one sanctioned per-call-site exception to lib/normalize.ts owning
    // every Temporal.Instant.from call (this array tops out around 150
    // server-aggregated buckets, not the capped live buffer the trace/log
    // filters run over). Parsed once per point, then reused for both the
    // range filter and the returned points.
    const withEpoch = s.points.map((p) => ({ ...p, epochNs: parseEpochNs(p.timestamp) }));
    const windowed = filterDataPointsInRange(withEpoch, range, (p) => p.epochNs);
    return {
      key: label,
      label,
      colorIndex,
      points: windowed.map((p) => ({
        timestamp: p.timestamp,
        epochNs: p.epochNs,
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
  // rangeDataPoints is already the store's DataPoint view model, so its
  // epochNs is a pre-parsed field, not re-parsed here (see lib/normalize.ts).
  const windowed = filterDataPointsInRange(rangeDataPoints, range, (dp) => dp.epochNs);
  const groups = new Map<string, StatTileGroup>();
  for (const dp of windowed) {
    const key = facetSeriesKey(dp.attributes, facet);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: key || "(no attributes)", colorIndex: 0, points: [] };
      groups.set(key, group);
    }
    group.points.push({
      timestamp: dp.timestamp,
      epochNs: dp.epochNs,
      value: dp.value,
      count: dp.count,
    });
  }
  const result = [...groups.values()];
  const colorIndexes = seriesColorIndexes(result.map((group) => group.key));
  return result.map((group, index) => ({ ...group, colorIndex: colorIndexes[index]! }));
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
      ? statTileGroupsFromAggregate(input.aggregatedSeries, input.facet, input.range)
      : statTileGroupsFromRawPoints(input.rangeDataPoints, input.facet, input.range);
  return combineStatTileGroups(groups, input.mode, input.includeLatestCount);
}
