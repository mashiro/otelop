import { memo, useMemo } from "react";
import {
  computeStatTiles,
  hasStatTileSignal,
  type StatTile,
  type StatTilesInput,
} from "@/lib/metric-stats";
import { isDistributionMetric, resolveMetricUnit, type MetricFacet } from "@/lib/metric-catalog";
import { formatMetricValue } from "@/lib/format-metric";
import { CHART_TIME_RANGES, type ChartTimeRange } from "@/lib/chart-time-range";
import { SERIES_COLORS } from "./metric-chart";
import type { AggregateSeriesData } from "@/hooks/use-metric-aggregate-series";
import type { DataPoint, MetricData } from "@/types/telemetry";

function rangeLabel(range: ChartTimeRange): string {
  return CHART_TIME_RANGES.find((r) => r.value === range)?.label ?? range;
}

// Memoized so a WS delivery that doesn't move rangeDataPoints/aggregatedSeries
// (both kept reference-stable upstream — see use-metric-range-points.ts /
// use-metric-aggregate-series.ts / metric-detail.tsx's stableMetric) skips
// recomputing and re-rendering the tiles.
export const MetricSummary = memo(function MetricSummary({
  metric,
  facet,
  range,
  rangeDataPoints,
  aggregatedSeries,
}: {
  metric: MetricData;
  facet?: MetricFacet | null;
  range: ChartTimeRange;
  rangeDataPoints: DataPoint[];
  aggregatedSeries: AggregateSeriesData[] | null;
}) {
  const isDistribution = isDistributionMetric(metric.type);
  const tiles = useMemo(() => {
    const eligible = hasStatTileSignal(metric.dataPoints);
    const input: StatTilesInput = facet
      ? {
          kind: "aggregate",
          aggregatedSeries: aggregatedSeries ?? [],
          rangeDataPoints,
          facet,
          range,
          isDistribution,
          eligible,
        }
      : { kind: "raw", rangeDataPoints, facet: null, range, isDistribution, eligible };
    return computeStatTiles(input);
  }, [metric.dataPoints, facet, aggregatedSeries, rangeDataPoints, range, isDistribution]);

  if (tiles.length === 0) return null;

  const unit = resolveMetricUnit(metric.name, metric.unit);
  const showLabels = tiles.length > 1 || tiles[0]?.key !== "";

  return (
    <div className="mb-4">
      <div
        className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        title={`Sum over the selected ${rangeLabel(range)} window`}
      >
        Total · {rangeLabel(range)}
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

function mainText(tile: StatTile, unit: string, isDistribution: boolean): string {
  if (isDistribution) {
    if (tile.totalSum != null) return formatMetricValue(tile.totalSum, unit);
    if (tile.totalCount != null) return tile.totalCount.toLocaleString();
    return "-";
  }
  return tile.total != null ? formatMetricValue(tile.total, unit) : "-";
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
  const color = SERIES_COLORS[tile.colorIndex % SERIES_COLORS.length];
  const main = mainText(tile, unit, isDistribution);
  const count =
    isDistribution && tile.totalSum != null && tile.totalCount != null
      ? tile.totalCount.toLocaleString()
      : null;

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
      {count && <div className="mt-0.5 text-xs text-muted-foreground">count {count}</div>}
    </div>
  );
}
