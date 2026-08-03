import { memo, useMemo } from "react";
import {
  attrKey,
  computeStatTiles,
  facetGroupLabel,
  hasIncreaseStatTileSignal,
  type StatTile,
  type StatTilesInput,
} from "@/lib/metric-stats";
import { isDistributionMetric, resolveMetricUnit, type MetricFacet } from "@/lib/metric-catalog";
import { formatMetricValue } from "@/lib/format-metric";
import { CHART_TIME_RANGES } from "@/lib/chart-time-range";
import { eventWindowRange, type EventTimeWindow } from "@/lib/event-time-window";
import {
  facetGroupColorIdentity,
  SERIES_COLORS,
  seriesColorIndexes,
} from "@/lib/metric-series-colors";
import type { AggregateSeriesData } from "@/hooks/use-metric-aggregate-series";
import type { MetricDistributionSeriesData } from "@/hooks/use-metric-distribution-stats";
import type { DataPoint, MetricData } from "@/types/telemetry";

function rangeLabel(window: EventTimeWindow): string {
  const range = eventWindowRange(window);
  if (range === null) return "Custom";
  return CHART_TIME_RANGES.find((r) => r.value === range)?.label ?? range;
}

// Memoized so a WS delivery that doesn't move rangeDataPoints/aggregatedSeries
// (both kept reference-stable upstream — see use-metric-range-points.ts /
// use-metric-aggregate-series.ts / metric-detail.tsx's stableMetric) skips
// recomputing and re-rendering the tiles.
export const MetricSummary = memo(function MetricSummary({
  metric,
  facet,
  window,
  rangeDataPoints,
  aggregatedSeries,
  distributionStats,
  distributionGroupBy = null,
}: {
  metric: MetricData;
  facet?: MetricFacet | null;
  window: EventTimeWindow;
  rangeDataPoints: DataPoint[];
  aggregatedSeries: AggregateSeriesData[] | null;
  distributionStats?: MetricDistributionSeriesData[] | null;
  distributionGroupBy?: string[] | null;
}) {
  const isDistribution = isDistributionMetric(metric.type);
  const isHistogram = metric.type === "Histogram" || metric.type === "ExponentialHistogram";
  const unit = resolveMetricUnit(metric.name, metric.unit);
  const showsLatest = metric.type === "Gauge" || isDistribution;
  const tiles = useMemo(() => {
    // Increase eligibility must read rangeDataPoints (the fetched-range + live
    // buffer merge), because the metrics list no longer loads point history.
    // Latest mode only needs a point and therefore applies to Gauge and
    // distribution metrics without a cumulative-family field.
    if (!showsLatest && !hasIncreaseStatTileSignal(rangeDataPoints)) return [];
    // A Gauge's "Latest" is the latest underlying observation, not the mean
    // of whichever aggregate bucket happens to be last. Bucket width may
    // change when the window changes; the summary value must not.
    const input: StatTilesInput =
      facet && metric.type !== "Gauge"
        ? {
            kind: "aggregate",
            aggregatedSeries: aggregatedSeries ?? [],
            facet,
            window,
            mode: showsLatest ? "latest" : "increase",
            includeLatestCount: isDistribution,
          }
        : {
            kind: "raw",
            rangeDataPoints,
            facet: facet ?? null,
            window,
            mode:
              metric.type === "Gauge" ? "latest-sum-series" : showsLatest ? "latest" : "increase",
            includeLatestCount: isDistribution,
          };
    return computeStatTiles(input);
  }, [facet, aggregatedSeries, rangeDataPoints, window, isDistribution, showsLatest, metric.type]);

  if (isHistogram && distributionStats) {
    return (
      <HistogramSummary
        series={distributionStats}
        groupBy={distributionGroupBy}
        facet={facet}
        window={window}
        unit={unit}
      />
    );
  }

  if (tiles.length === 0) return null;

  const showLabels = tiles.length > 1 || tiles[0]?.key !== "";

  return (
    <div className="mb-4">
      <div
        className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        title={
          showsLatest
            ? `Latest value in the selected ${rangeLabel(window)} window`
            : `Increase over the selected ${rangeLabel(window)} window`
        }
      >
        {showsLatest ? "Latest" : "Increase"} · {rangeLabel(window)}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        {tiles.map((tile) => (
          <Tile
            key={tile.key}
            tile={tile}
            unit={unit}
            isDistribution={isDistribution}
            showLabel={showLabels}
          />
        ))}
      </div>
    </div>
  );
});

function HistogramSummary({
  series,
  groupBy,
  facet,
  window,
  unit,
}: {
  series: MetricDistributionSeriesData[];
  groupBy: string[] | null;
  facet?: MetricFacet | null;
  window: EventTimeWindow;
  unit: string;
}) {
  const rows = series.map((item) => {
    const label = facet
      ? facetGroupLabel(item.groupValues) || "(no attributes)"
      : attrKey(item.attributes) || "(no attributes)";
    const colorIdentity = facet
      ? facetGroupColorIdentity(facet, item.groupValues)
      : attrKey(item.attributes);
    return { item, label, colorIdentity };
  });
  if (rows.length === 0) return null;
  const colorIndexes = seriesColorIndexes(rows.map((row) => row.colorIdentity));

  const columns = [
    ["Average", (item: MetricDistributionSeriesData) => item.mean],
    ["Median", (item: MetricDistributionSeriesData) => item.p50],
    ["P90", (item: MetricDistributionSeriesData) => item.p90],
    ["P95", (item: MetricDistributionSeriesData) => item.p95],
    ["P99", (item: MetricDistributionSeriesData) => item.p99],
    ["Min", (item: MetricDistributionSeriesData) => item.min],
    ["Max", (item: MetricDistributionSeriesData) => item.max],
  ] as const;
  return (
    <div className="mb-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Distribution · {rangeLabel(window)}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border/30 bg-muted/50">
        <table className="w-full min-w-[880px] text-left text-xs">
          <thead className="border-b border-border/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Breakdown</th>
              <th className="px-3 py-2 text-right font-semibold">Observations</th>
              {columns.map(([label]) => (
                <th key={label} className="px-3 py-2 text-right font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {rows.map(({ item, label }, index) => (
              <tr key={JSON.stringify(groupBy ? item.groupValues : item.attributes)}>
                <td className="max-w-64 px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: SERIES_COLORS[colorIndexes[index]!] }}
                    />
                    <span className="truncate font-mono text-foreground/70" title={label}>
                      {label}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {item.count.toLocaleString()}
                </td>
                {columns.map(([column, value]) => {
                  const number = value(item);
                  return (
                    <td key={column} className="px-3 py-2.5 text-right tabular-nums">
                      {number != null ? formatMetricValue(number, unit) : "-"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function mainText(tile: StatTile, unit: string): string {
  return tile.value != null ? formatMetricValue(tile.value, unit) : "-";
}

function Tile({
  tile,
  unit,
  isDistribution,
  showLabel,
}: {
  tile: StatTile;
  unit: string;
  isDistribution: boolean;
  showLabel: boolean;
}) {
  const color = SERIES_COLORS[tile.colorIndex];
  const main = mainText(tile, unit);
  const count = isDistribution && tile.count != null ? tile.count.toLocaleString() : null;

  return (
    <div className="rounded-lg border border-border/30 bg-muted/50 p-3">
      {showLabel && (
        <div className="mb-1 flex items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="truncate font-mono text-xs text-foreground/60" title={tile.label}>
            {tile.label}
          </span>
        </div>
      )}
      <div className="text-2xl font-semibold text-foreground">{main}</div>
      {count !== null && <div className="mt-0.5 text-xs text-muted-foreground">count {count}</div>}
    </div>
  );
}
