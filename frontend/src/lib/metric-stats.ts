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

export interface CumulativeTile {
  key: string;
  label: string;
  // Position of this series in chart order (first appearance across ALL
  // dataPoints, cumulative or not), so tile colors match the chart lines.
  colorIndex: number;
  cumulative: number | null;
  countCumulative: number | null;
  sumCumulative: number | null;
}

// One tile per facet group, mirroring the chart's series grouping. The
// cumulative fields are per raw series (full attribute combination), so a
// facet group covering several raw series sums their latest snapshots — the
// raw series partition the same measurement stream, so the sum is exact.
// Points without any cumulative (e.g. the first observation of a series,
// which the backend uses as its delta baseline) are skipped so a null on the
// newest point doesn't hide an earlier total.
export function cumulativeTiles(metric: MetricData, facet?: MetricFacet | null): CumulativeTile[] {
  const groupOrder = new Map<string, number>();
  const latestByRawSeries = new Map<string, DataPoint>();
  for (const dp of metric.dataPoints) {
    const groupKey = facetSeriesKey(dp.attributes, facet);
    if (!groupOrder.has(groupKey)) groupOrder.set(groupKey, groupOrder.size);
    if (dp.cumulative == null && dp.countCumulative == null && dp.sumCumulative == null) continue;
    const rawKey = attrKey(dp.attributes);
    const prev = latestByRawSeries.get(rawKey);
    if (
      !prev ||
      Temporal.Instant.compare(
        Temporal.Instant.from(dp.timestamp),
        Temporal.Instant.from(prev.timestamp),
      ) >= 0
    ) {
      latestByRawSeries.set(rawKey, dp);
    }
  }

  const tiles = new Map<string, CumulativeTile>();
  for (const dp of latestByRawSeries.values()) {
    const key = facetSeriesKey(dp.attributes, facet);
    let tile = tiles.get(key);
    if (!tile) {
      tile = {
        key,
        label: key || "(no attributes)",
        colorIndex: groupOrder.get(key) ?? 0,
        cumulative: null,
        countCumulative: null,
        sumCumulative: null,
      };
      tiles.set(key, tile);
    }
    if (dp.cumulative != null) tile.cumulative = (tile.cumulative ?? 0) + dp.cumulative;
    if (dp.countCumulative != null) {
      tile.countCumulative = (tile.countCumulative ?? 0) + dp.countCumulative;
    }
    if (dp.sumCumulative != null) tile.sumCumulative = (tile.sumCumulative ?? 0) + dp.sumCumulative;
  }
  return [...tiles.values()].sort((a, b) => a.colorIndex - b.colorIndex);
}
