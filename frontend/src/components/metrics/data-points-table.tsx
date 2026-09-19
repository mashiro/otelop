import { attrKey } from "@/lib/metric-stats";
import { isDistributionMetric, resolveMetricUnit } from "@/lib/metric-catalog";
import { formatMetricValue } from "@/lib/format-metric";
import { formatTimestamp } from "@/lib/format";
import type { DataPoint, MetricData } from "@/types/telemetry";

const headCls = "px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground";
const numCellCls = "px-3 py-1.5 text-right font-mono text-foreground/70";

function formatDistributionCell(v: number | null | undefined, unit: string): string {
  return v != null ? formatMetricValue(v, unit) : "-";
}

export function DataPointsTable({
  metric,
  dataPoints,
  selectedId,
  onSelect,
}: {
  metric: MetricData;
  // Range-windowed rows from useMetricRangePoints, so the table reflects the
  // same scope as the tiles and chart above it.
  dataPoints: DataPoint[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const hasAttributes = dataPoints.some((dp) => Object.keys(dp.attributes).length > 0);
  const isDistribution = isDistributionMetric(metric.type);
  const unit = resolveMetricUnit(metric.name, metric.unit);

  return (
    <div>
      <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        Data Points ({dataPoints.length})
      </h4>
      <div className="max-h-90 overflow-auto rounded-md border border-border/30 bg-muted/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/30">
              <th className={`${headCls} text-left`}>Timestamp</th>
              {hasAttributes && <th className={`${headCls} text-left`}>Attributes</th>}
              <th className={`${headCls} text-right`}>{isDistribution ? "Mean" : "Value"}</th>
              {isDistribution && (
                <>
                  <th className={`${headCls} text-right`}>Count</th>
                  <th className={`${headCls} text-right`}>Sum</th>
                  <th className={`${headCls} text-right`}>Min</th>
                  <th className={`${headCls} text-right`}>Max</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {[...dataPoints].reverse().map((dp) => {
              const isSelected = selectedId === dp.id;
              return (
                <tr
                  key={dp.id}
                  className={`cursor-pointer border-b border-border/20 last:border-0 transition-colors hover:bg-metric/5 ${isSelected ? "bg-metric/10" : ""}`}
                  onClick={() => onSelect(isSelected ? null : dp.id)}
                >
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">
                    {formatTimestamp(dp.timestamp)}
                  </td>
                  {hasAttributes && (
                    <td className="max-w-62.5 truncate px-3 py-1.5 font-mono text-foreground/60">
                      {attrKey(dp.attributes) || "-"}
                    </td>
                  )}
                  <td className="px-3 py-1.5 text-right font-mono text-metric">
                    {formatMetricValue(dp.value, unit)}
                  </td>
                  {isDistribution && (
                    <>
                      <td className={numCellCls}>
                        {dp.count != null ? dp.count.toLocaleString() : "-"}
                      </td>
                      <td className={numCellCls}>{formatDistributionCell(dp.sum, unit)}</td>
                      <td className={numCellCls}>{formatDistributionCell(dp.min, unit)}</td>
                      <td className={numCellCls}>{formatDistributionCell(dp.max, unit)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
