import { memo, useMemo } from "react";
import {
  computeStatTiles,
  hasIncreaseStatTileSignal,
  type StatTile,
  type StatTilesInput,
} from "@/lib/metric-stats";
import { isDistributionMetric, resolveMetricUnit, type MetricFacet } from "@/lib/metric-catalog";
import { formatMetricValue } from "@/lib/format-metric";
import { CHART_TIME_RANGES, type ChartTimeRange } from "@/lib/chart-time-range";
import { SERIES_COLORS } from "./metric-chart";
import type { AggregateSeriesData } from "@/hooks/use-metric-aggregate-series";
import type { MetricDistributionStatsData } from "@/hooks/use-metric-distribution-stats";
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
  distributionStats,
}: {
  metric: MetricData;
  facet?: MetricFacet | null;
  range: ChartTimeRange;
  rangeDataPoints: DataPoint[];
  aggregatedSeries: AggregateSeriesData[] | null;
  distributionStats?: MetricDistributionStatsData | null;
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
    const input: StatTilesInput = facet
      ? {
          kind: "aggregate",
          aggregatedSeries: aggregatedSeries ?? [],
          rangeDataPoints,
          facet,
          range,
          mode: showsLatest ? "latest" : "increase",
          includeLatestCount: isDistribution,
        }
      : {
          kind: "raw",
          rangeDataPoints,
          facet: null,
          range,
          mode: showsLatest ? "latest" : "increase",
          includeLatestCount: isDistribution,
        };
    return computeStatTiles(input);
  }, [facet, aggregatedSeries, rangeDataPoints, range, isDistribution, showsLatest]);

  if (isHistogram && distributionStats) {
    return <HistogramSummary stats={distributionStats} range={range} unit={unit} />;
  }

  if (tiles.length === 0) return null;

  const showLabels = tiles.length > 1 || tiles[0]?.key !== "";

  return (
    <div className="mb-4">
      <div
        className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        title={
          showsLatest
            ? `Latest value in the selected ${rangeLabel(range)} window`
            : `Increase over the selected ${rangeLabel(range)} window`
        }
      >
        {showsLatest ? "Latest" : "Increase"} · {rangeLabel(range)}
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
  stats,
  range,
  unit,
}: {
  stats: MetricDistributionStatsData;
  range: ChartTimeRange;
  unit: string;
}) {
  const values = [
    ["Average", stats.mean],
    ["P50", stats.p50],
    ["P90", stats.p90],
    ["P95", stats.p95],
    ["P99", stats.p99],
    ["Min", stats.min],
    ["Max", stats.max],
  ] as const;
  return (
    <div className="mb-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Distribution · {rangeLabel(range)} · {stats.count.toLocaleString()} observations
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
        {values.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border/30 bg-muted/50 p-3">
            <div className="mb-1 text-xs text-foreground/60">{label}</div>
            <div className="text-2xl font-semibold text-foreground">
              {value != null ? formatMetricValue(value, unit) : "-"}
            </div>
          </div>
        ))}
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
  const color = SERIES_COLORS[tile.colorIndex % SERIES_COLORS.length];
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
