import { attrKey } from "@/lib/metric-stats";
import { isDistributionMetric, resolveMetricUnit } from "@/lib/metric-catalog";
import { formatMetricValue } from "@/lib/format-metric";
import { formatTimestamp } from "@/lib/format";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import type { DataPoint, MetricData } from "@/types/telemetry";

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
      <Card size="flush" className="max-h-90 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              {hasAttributes && <TableHead>Attributes</TableHead>}
              <TableHead align="right">{isDistribution ? "Mean" : "Value"}</TableHead>
              {isDistribution && (
                <>
                  <TableHead align="right">Count</TableHead>
                  <TableHead align="right">Sum</TableHead>
                  <TableHead align="right">Min</TableHead>
                  <TableHead align="right">Max</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...dataPoints].reverse().map((dp) => {
              const isSelected = selectedId === dp.id;
              return (
                <TableRow
                  key={dp.id}
                  tone="metric"
                  interactive
                  selected={isSelected}
                  aria-selected={isSelected}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(isSelected ? null : dp.id);
                    }
                  }}
                  onClick={() => onSelect(isSelected ? null : dp.id)}
                >
                  <TableCell variant="mono" emphasis="muted">
                    {formatTimestamp(dp.timestamp)}
                  </TableCell>
                  {hasAttributes && (
                    <TableCell variant="mono" emphasis="secondary" truncate className="max-w-62.5">
                      {attrKey(dp.attributes) || "-"}
                    </TableCell>
                  )}
                  <TableCell variant="mono" align="right" tone="metric">
                    {formatMetricValue(dp.value, unit)}
                  </TableCell>
                  {isDistribution && (
                    <>
                      <TableCell variant="mono" align="right" emphasis="secondary">
                        {dp.count != null ? dp.count.toLocaleString() : "-"}
                      </TableCell>
                      <TableCell variant="mono" align="right" emphasis="secondary">
                        {formatDistributionCell(dp.sum, unit)}
                      </TableCell>
                      <TableCell variant="mono" align="right" emphasis="secondary">
                        {formatDistributionCell(dp.min, unit)}
                      </TableCell>
                      <TableCell variant="mono" align="right" emphasis="secondary">
                        {formatDistributionCell(dp.max, unit)}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
