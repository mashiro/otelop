import { Temporal } from "temporal-polyfill";
import type { DataPoint, MetricData } from "@/types/telemetry";
import type { MetricFacet } from "@/lib/metric-catalog";

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

interface LatestByRaw {
  dp: DataPoint;
  ts: Temporal.Instant;
  groupKey: string;
}

// One tile per facet group, mirroring the chart's series grouping. Uses the
// running total the backend populates on cumulative fields: monotonic Sum
// gets `cumulative`, distributions get `count/sumCumulative`. Gauge and
// non-monotonic Sum carry no cumulative, so they yield no tiles.
//
// Raw series that fall into the same facet group are summed — they partition
// the same measurement stream, so the sum is exact. groupOrder tracks first
// appearance across all points (not just those with cumulative) so tile
// colors stay aligned with the chart, even if some series arrive later.
export function statTiles(metric: MetricData, facet?: MetricFacet | null): StatTile[] {
  const groupOrder = new Map<string, number>();
  const latestByRaw = new Map<string, LatestByRaw>();

  for (const dp of metric.dataPoints) {
    const rawKey = attrKey(dp.attributes);
    const groupKey = facet ? facetSeriesKey(dp.attributes, facet) : rawKey;
    if (!groupOrder.has(groupKey)) groupOrder.set(groupKey, groupOrder.size);
    if (dp.cumulative == null && dp.countCumulative == null && dp.sumCumulative == null) continue;
    const ts = Temporal.Instant.from(dp.timestamp);
    const prev = latestByRaw.get(rawKey);
    if (!prev || Temporal.Instant.compare(ts, prev.ts) >= 0) {
      latestByRaw.set(rawKey, { dp, ts, groupKey });
    }
  }

  const tiles = new Map<string, StatTile>();
  for (const { dp, groupKey } of latestByRaw.values()) {
    let tile = tiles.get(groupKey);
    if (!tile) {
      tile = {
        key: groupKey,
        label: groupKey || "(no attributes)",
        colorIndex: groupOrder.get(groupKey)!,
        total: null,
        totalCount: null,
        totalSum: null,
      };
      tiles.set(groupKey, tile);
    }
    if (dp.cumulative != null) tile.total = (tile.total ?? 0) + dp.cumulative;
    if (dp.countCumulative != null) tile.totalCount = (tile.totalCount ?? 0) + dp.countCumulative;
    if (dp.sumCumulative != null) tile.totalSum = (tile.totalSum ?? 0) + dp.sumCumulative;
  }
  return [...tiles.values()].sort((a, b) => a.colorIndex - b.colorIndex);
}
