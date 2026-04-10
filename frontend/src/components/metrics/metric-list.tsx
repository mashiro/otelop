import { useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { metricsAtom, selectedMetricAtom } from "@/stores/telemetry";
import { filteredMetricsAtom } from "@/stores/filters";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MetricFilters } from "@/components/filters/metric-filters";
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
    return (
      <div className="glass-card flex h-full items-center justify-center">
        <div className="animate-slide-up-fade flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-metric/10">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--metric)"
              strokeWidth="1.5"
            >
              <path d="M3 3v18h18" />
              <path d="M7 16l4-8 4 4 6-10" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground/70">No metrics yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Send OTLP data to see them here</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card flex h-full flex-col overflow-hidden">
      <MetricFilters />
      {metrics.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">No matching metrics</p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50 hover:bg-transparent">
                <TableHead className="text-metric/70">Service</TableHead>
                <TableHead className="text-metric/70">Name</TableHead>
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
                    <TableCell>
                      <span className="rounded-full bg-metric/15 px-2 py-0.5 text-[11px] font-medium text-metric">
                        {metric.type}
                      </span>
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
    </div>
  );
}
