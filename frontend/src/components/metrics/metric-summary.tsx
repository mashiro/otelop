import { useMemo } from "react";
import { cumulativeTiles, type CumulativeTile } from "@/lib/metric-stats";
import { isDistributionMetric, resolveMetricUnit, type MetricFacet } from "@/lib/metric-catalog";
import { formatMetricValue } from "@/lib/format-metric";
import { SERIES_COLORS } from "./metric-chart";
import type { MetricData } from "@/types/telemetry";

const RESET_NOTE =
  "Raw cumulative reported by the exporter, since otelop started observing this series. Resets when otelop restarts.";

export function MetricSummary({
  metric,
  facet,
}: {
  metric: MetricData;
  facet?: MetricFacet | null;
}) {
  const tiles = useMemo(() => cumulativeTiles(metric, facet), [metric, facet]);
  if (tiles.length === 0) return null;

  const unit = resolveMetricUnit(metric.name, metric.unit);
  const isDistribution = isDistributionMetric(metric.type);
  const showLabels = tiles.length > 1 || tiles[0]?.key !== "";

  return (
    <div className="mb-4">
      <div
        className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        title={RESET_NOTE}
      >
        Total · Since observing
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
}

function Tile({
  tile,
  unit,
  isDistribution,
  showLabel,
}: {
  tile: CumulativeTile;
  unit: string;
  isDistribution: boolean;
  showLabel: boolean;
}) {
  const color = SERIES_COLORS[tile.colorIndex % SERIES_COLORS.length];
  const main = isDistribution
    ? tile.sumCumulative != null
      ? formatMetricValue(tile.sumCumulative, unit)
      : (tile.countCumulative?.toLocaleString() ?? "-")
    : tile.cumulative != null
      ? formatMetricValue(tile.cumulative, unit)
      : "-";
  const count =
    isDistribution && tile.sumCumulative != null && tile.countCumulative != null
      ? tile.countCumulative.toLocaleString()
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
      <div className="font-mono text-2xl font-medium text-foreground">{main}</div>
      {count && <div className="mt-0.5 text-xs text-muted-foreground">count {count}</div>}
    </div>
  );
}
