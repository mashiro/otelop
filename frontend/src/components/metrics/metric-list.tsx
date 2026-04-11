import { useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { metricsAtom, selectedMetricAtom } from "@/stores/telemetry";
import { filteredMetricsAtom, metricSearchAtom } from "@/stores/filters";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchFilter } from "@/components/filters/search-filter";
import { ListPanel } from "@/components/common/list-panel";
import { EmptyMatches } from "@/components/common/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/format";
import { MetricDetail } from "./metric-detail";
import { EmptyState } from "@/components/common/empty-state";
import { Pill } from "@/components/common/pill";
import { SIGNALS } from "@/lib/signals";

export function MetricList() {
  const allMetrics = useAtomValue(metricsAtom);
  const filtered = useAtomValue(filteredMetricsAtom);
  const metrics = useMemo(
    () => [...filtered].sort((a, b) => a.name.localeCompare(b.name)),
    [filtered],
  );
  const selectedMetric = useAtomValue(selectedMetricAtom);
  const setSelectedMetric = useSetAtom(selectedMetricAtom);

  if (selectedMetric) {
    return <MetricDetail />;
  }

  if (allMetrics.length === 0) {
    return <EmptyState signal={SIGNALS.metrics} />;
  }

  return (
    <ListPanel toolbar={<SearchFilter atom={metricSearchAtom} placeholder="Search metrics..." />}>
      {metrics.length === 0 ? (
        <EmptyMatches label="metrics" />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50 bg-muted hover:bg-muted">
                <TableHead className="text-metric/70">Service</TableHead>
                <TableHead className="text-metric/70">Name</TableHead>
                <TableHead className="text-metric/70">Description</TableHead>
                <TableHead className="text-metric/70">Type</TableHead>
                <TableHead className="text-metric/70">Unit</TableHead>
                <TableHead className="text-right text-metric/70">Points</TableHead>
                <TableHead className="text-right text-metric/70">Latest Value</TableHead>
                <TableHead className="text-metric/70">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map((metric, i) => {
                const lastPoint = metric.dataPoints[metric.dataPoints.length - 1];
                return (
                  <TableRow
                    key={`${metric.name}-${i}`}
                    className="stagger-row cursor-pointer border-b border-border/30 transition-colors hover:bg-metric/5"
                    style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}
                    onClick={() => setSelectedMetric(metric)}
                  >
                    <TableCell className="font-medium">{metric.serviceName || "-"}</TableCell>
                    <TableCell className="text-foreground/80">{metric.name}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {metric.description || "-"}
                    </TableCell>
                    <TableCell>
                      <Pill tone="metric">{metric.type}</Pill>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{metric.unit || "-"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {metric.dataPoints.length}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-metric">
                      {lastPoint ? lastPoint.value.toLocaleString() : "-"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatRelativeTime(metric.receivedAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </ListPanel>
  );
}
