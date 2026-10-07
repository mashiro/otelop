import { useSignalQuery, useMetricSelection } from "@/hooks/use-signal-route";
import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { metricsAtom, renderWindowMaxAtom } from "@/stores/telemetry";
import { createFilteredMetricsAtom } from "@/stores/filters";
import { ScrollableTable } from "@/components/common/scrollable-table";
import { SearchFilter } from "@/components/filters/search-filter";
import { ListPanel } from "@/components/common/list-panel";
import { EmptyMatches } from "@/components/common/empty-state";
import { LoadMoreRow } from "@/components/common/load-more-row";
import { BackToLatestRow } from "@/components/common/back-to-latest-row";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/format";
import { resolveMetricUnit } from "@/lib/metric-catalog";
import { MetricAddFilter, MetricFilterBar } from "./metric-filter-bar";
import { MetricDetail } from "./metric-detail";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  const { state, search, setText } = useSignalQuery("metrics");
  const searchRequest = useMetricListSearch(search);
  const filtered = useAtomValue(useMemo(() => createFilteredMetricsAtom(search), [search]));
  const metrics = useMemo(
    () => [...filtered].sort((a, b) => a.name.localeCompare(b.name)),
    [filtered],
  );
  const { metric: selectedMetric, selectMetric: setSelectedMetric } = useMetricSelection();
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
  if (allMetrics.length === 0 && !search && state.filters.length === 0) {
    return <EmptyState signal={SIGNALS.metrics} />;
  }

  return (
    <ListPanel
      toolbarSecondary={state.filters.length > 0 ? <MetricFilterBar /> : null}
      toolbar={
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <SearchFilter
            value={state.text}
            onSubmit={setText}
            placeholder="Search metric names…"
            className="min-w-0 max-w-none @min-[48rem]/list:max-w-80"
          />
          <MetricAddFilter />
        </div>
      }
    >
      {searchRequest.isSearching ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Searching metrics…
        </p>
      ) : searchRequest.isError ? (
        <div role="alert" className="flex items-center gap-3 p-4 text-sm">
          <p className="text-destructive">Could not search metrics. Please try again.</p>
          <Button variant="outline" size="sm" onClick={searchRequest.retry}>
            Retry
          </Button>
        </div>
      ) : null}
      {metrics.length === 0 ? (
        !searchRequest.isSearching && !searchRequest.isError ? (
          <EmptyMatches label="metrics" />
        ) : null
      ) : (
        <ScrollableTable
          before={
            <BackToLatestRow
              count={renderWindow.newerCount}
              label="earlier — back to top"
              onClick={renderWindow.backToLatest}
            />
          }
          header={
            <TableHeader>
              <TableRow>
                <TableHead tone="metric">Service</TableHead>
                <TableHead tone="metric">Name</TableHead>
                <TableHead tone="metric">Description</TableHead>
                <TableHead tone="metric">Type</TableHead>
                <TableHead tone="metric">Unit</TableHead>
                <TableHead tone="metric" className="text-right">
                  Points
                </TableHead>
                <TableHead tone="metric" className="text-right">
                  Latest Value
                </TableHead>
                <TableHead tone="metric">Received</TableHead>
              </TableRow>
            </TableHeader>
          }
          after={
            <LoadMoreRow
              visible={renderWindow.olderCount > 0}
              loadingMore={false}
              onClick={handleSlide}
            />
          }
        >
          <TableBody>
            {renderWindow.visible.map((metric) => (
              <MetricRow key={metricRowId(metric)} metric={metric} onSelect={setSelectedMetric} />
            ))}
          </TableBody>
        </ScrollableTable>
      )}
    </ListPanel>
  );
}

interface MetricRowProps {
  metric: MetricData;
  onSelect: (metric: MetricData) => void;
}

// Row bail-out is provided by React Compiler.
function MetricRow({ metric, onSelect }: MetricRowProps) {
  return (
    <TableRow tone="metric" interactive stagger onClick={() => onSelect(metric)}>
      <TableCell emphasis="strong">{metric.serviceName || "-"}</TableCell>
      <TableCell emphasis="secondary">{metric.name}</TableCell>
      <TableCell emphasis="muted" truncate className="max-w-xs">
        {metric.description || "-"}
      </TableCell>
      <TableCell>
        <Badge variant="soft" size="sm" tone="metric">
          {metric.type}
        </Badge>
      </TableCell>
      <TableCell emphasis="muted">{resolveMetricUnit(metric.name, metric.unit) || "-"}</TableCell>
      <TableCell variant="mono" align="right">
        {metric.pointCount}
      </TableCell>
      <TableCell variant="mono" tone="metric" align="right">
        {metric.latestValue != null ? metric.latestValue.toLocaleString() : "-"}
      </TableCell>
      <TableCell emphasis="muted" size="xs">
        {formatRelativeTime(metric.receivedAt)}
      </TableCell>
    </TableRow>
  );
}
