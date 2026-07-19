import { memo, useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { metricsAtom, selectedMetricAtom } from "@/stores/telemetry";
import { filteredMetricsAtom, metricSearchAtom } from "@/stores/filters";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchFilter } from "@/components/filters/search-filter";
import { ListPanel } from "@/components/common/list-panel";
import { EmptyMatches } from "@/components/common/empty-state";
import { ListOverflowNotice } from "@/components/common/list-overflow-notice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/format";
import { resolveMetricUnit } from "@/lib/metric-catalog";
import { MetricDetail } from "./metric-detail";
import { EmptyState } from "@/components/common/empty-state";
import { Pill } from "@/components/common/pill";
import { SIGNALS } from "@/lib/signals";
import { useMetricListSearch } from "@/hooks/use-metric-list-search";
import type { MetricData } from "@/types/telemetry";
import { LIST_DISPLAY_CAP } from "@/lib/list-render-cap";

export function MetricList() {
  const allMetrics = useAtomValue(metricsAtom);
  const search = useAtomValue(metricSearchAtom);
  useMetricListSearch(search);
  const filtered = useAtomValue(filteredMetricsAtom);
  const metrics = useMemo(
    () => [...filtered].sort((a, b) => a.name.localeCompare(b.name)),
    [filtered],
  );
  const selectedMetric = useAtomValue(selectedMetricAtom);
  const setSelectedMetric = useSetAtom(selectedMetricAtom);

  if (selectedMetric) {
    // Remount when a different metric is picked so facet state in MetricDetail
    // resets cleanly instead of clinging to an attribute that may not exist
    // in the new metric.
    return <MetricDetail key={selectedMetric.name} />;
  }

  // Only the true "nothing has ever arrived" case gets the full EmptyState;
  // an active search must keep the toolbar (and its search box) mounted even
  // when allMetrics is otherwise empty, matching filteredMetricsAtom's own
  // zero-hit case below (EmptyMatches) — see stores/filters.ts's
  // filteredMetricsAtom and hooks/use-metric-list-search.ts for the bug this
  // guards against.
  if (allMetrics.length === 0 && !search) {
    return <EmptyState signal={SIGNALS.metrics} />;
  }

  const visibleMetrics = metrics.slice(0, LIST_DISPLAY_CAP);
  const hiddenMetricCount = metrics.length - visibleMetrics.length;

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
              {visibleMetrics.map((metric, i) => (
                <MetricRow
                  key={`${metric.serviceName}-${metric.name}`}
                  metric={metric}
                  index={i}
                  onSelect={setSelectedMetric}
                />
              ))}
            </TableBody>
          </Table>
          <ListOverflowNotice hiddenCount={hiddenMetricCount} />
        </ScrollArea>
      )}
    </ListPanel>
  );
}

interface MetricRowProps {
  metric: MetricData;
  index: number;
  onSelect: (metric: MetricData) => void;
}

// Memoized for the same reason as logs/log-list.tsx's LogRow: a WS delivery
// or an unrelated re-render shouldn't force every already-rendered row to
// re-render. `metric` is stable unless that specific group was updated;
// `onSelect` is a jotai setter, stable by construction.
const MetricRow = memo(function MetricRow({ metric, index, onSelect }: MetricRowProps) {
  return (
    <TableRow
      className="stagger-row cursor-pointer border-b border-border/30 transition-colors hover:bg-metric/5"
      style={{ animationDelay: `${Math.min(index * 20, 200)}ms` }}
      onClick={() => onSelect(metric)}
    >
      <TableCell className="font-medium">{metric.serviceName || "-"}</TableCell>
      <TableCell className="text-foreground/80">{metric.name}</TableCell>
      <TableCell className="max-w-xs truncate text-muted-foreground">
        {metric.description || "-"}
      </TableCell>
      <TableCell>
        <Pill tone="metric">{metric.type}</Pill>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {resolveMetricUnit(metric.name, metric.unit) || "-"}
      </TableCell>
      <TableCell className="text-right font-mono text-xs">{metric.pointCount}</TableCell>
      <TableCell className="text-right font-mono text-xs text-metric">
        {metric.latestValue != null ? metric.latestValue.toLocaleString() : "-"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatRelativeTime(metric.receivedAt)}
      </TableCell>
    </TableRow>
  );
});
