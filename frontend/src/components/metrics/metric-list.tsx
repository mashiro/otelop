import { useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { metricsAtom, selectedMetricAtom, renderWindowMaxAtom } from "@/stores/telemetry";
import { filteredMetricsAtom, metricSearchAtom } from "@/stores/filters";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchFilter } from "@/components/filters/search-filter";
import { ListPanel } from "@/components/common/list-panel";
import { EmptyMatches } from "@/components/common/empty-state";
import { LoadMoreRow } from "@/components/common/load-more-row";
import { BackToLatestRow } from "@/components/common/back-to-latest-row";
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
import { SIGNAL_PAGE_SIZE } from "@/hooks/use-signal-list-page";
import { useRenderWindow } from "@/hooks/use-render-window";
import type { MetricData } from "@/types/telemetry";

function metricRowId(metric: MetricData): string {
  return `${metric.serviceName}-${metric.name}`;
}

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
  const renderWindowMax = useAtomValue(renderWindowMaxAtom);
  // Metrics have no server-side pagination (filteredMetricsAtom's whole
  // match set is already in memory), so "Load more" only ever slides the
  // window over what's already loaded — see handleSlide below. The window
  // resets to the top on a search change (its only filter scope).
  const renderWindow = useRenderWindow({
    items: metrics,
    getId: metricRowId,
    max: renderWindowMax,
    pageSize: SIGNAL_PAGE_SIZE,
    resetKey: search,
  });
  const handleSlide = () => renderWindow.slideOlder(metrics);

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

  return (
    <ListPanel toolbar={<SearchFilter atom={metricSearchAtom} placeholder="Search metrics..." />}>
      {metrics.length === 0 ? (
        <EmptyMatches label="metrics" />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <BackToLatestRow
            count={renderWindow.newerCount}
            label="earlier — back to top"
            onClick={renderWindow.backToLatest}
          />
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
              {renderWindow.visible.map((metric, i) => (
                <MetricRow
                  key={metricRowId(metric)}
                  metric={metric}
                  index={i}
                  onSelect={setSelectedMetric}
                />
              ))}
            </TableBody>
          </Table>
          <LoadMoreRow
            visible={renderWindow.olderCount > 0}
            loadingMore={false}
            onClick={handleSlide}
          />
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

// Row bail-out is provided by React Compiler.
function MetricRow({ metric, index, onSelect }: MetricRowProps) {
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
}
