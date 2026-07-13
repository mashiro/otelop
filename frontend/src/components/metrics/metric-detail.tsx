import { memo, useMemo, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { X } from "lucide-react";
import { selectedMetricAtom } from "@/stores/telemetry";
import { metricTimeWindowAtom } from "@/stores/navigation";
import { MetricChart } from "./metric-chart";
import { MetricSummary } from "./metric-summary";
import { attrKey } from "@/lib/metric-stats";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DetailPanel } from "@/components/common/detail-panel";
import { Pill } from "@/components/common/pill";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimeWindowControls } from "@/components/common/event-window-controls";
import { KVSection } from "@/components/ui/kv-section";
import { Field } from "@/components/common/detail-field";
import {
  facetId,
  isDistributionMetric,
  resolveMetricFacets,
  resolveMetricUnit,
  type MetricFacet,
} from "@/lib/metric-catalog";
import { formatMetricValue } from "@/lib/format-metric";
import { formatTimestamp } from "@/lib/format";
import { DEFAULT_CHART_TIME_RANGE } from "@/lib/chart-time-range";
import { eventWindowRange } from "@/lib/event-time-window";
import { useMetricRangePoints } from "@/hooks/use-metric-range-points";
import { useMetricAggregateSeries } from "@/hooks/use-metric-aggregate-series";
import type { DataPoint, MetricData } from "@/types/telemetry";

const ALL_FACET = "__all__";

export function MetricDetail() {
  const metric = useAtomValue(selectedMetricAtom);
  const setSelected = useSetAtom(selectedMetricAtom);

  if (!metric) return null;

  const displayUnit = resolveMetricUnit(metric.name, metric.unit);

  return (
    <DetailPanel
      onClose={() => setSelected(null)}
      header={
        <>
          <span className="font-semibold text-foreground">{metric.name}</span>
          <Pill tone="metric">{metric.type}</Pill>
          {displayUnit && <span className="text-xs text-muted-foreground">({displayUnit})</span>}
          <span className="text-xs text-muted-foreground">{metric.serviceName}</span>
        </>
      }
    >
      <MetricDetailBody metric={metric} />
    </DetailPanel>
  );
}

// Facet selection lives here (not in the chart) because the summary tiles and
// the chart must break down by the same dimension. Exported for direct
// testing (see metric-detail.test.tsx), the same way DataPointsTable/
// DataPointDetail below are, so tests don't need to thread selectedMetricAtom.
export function MetricDetailBody({ metric }: { metric: MetricData }) {
  // Time range is the scope for the whole detail view (tiles, chart, and
  // table all read the same window), so it's lifted here rather than owned
  // by MetricChart — see metric-stats.ts's computeStatTiles. Defaults to a
  // recent window rather than "all": DuckDB history is fetched on demand, so
  // opening a long-lived metric shouldn't eagerly pull its full retention.
  // Synced to the URL (unlike pickedId below) so a shared/reloaded link
  // reopens the same window — see metricTimeWindowAtom in navigation.ts.
  const [window, setWindow] = useAtom(metricTimeWindowAtom);
  const range = eventWindowRange(window) ?? DEFAULT_CHART_TIME_RANGE;
  // rangeDataPoints (the fetched-range + live-buffer merge, already stable by
  // id — see use-metric-range-points.ts) is the source of truth for
  // everything below, not metric.dataPoints: the metrics list's initial load
  // no longer populates dataPoints (issue #162), so a metric opened before
  // its first WS delivery would otherwise show no facets/table/selectable
  // rows despite its history already being fetched.
  const rangeDataPoints = useMetricRangePoints(metric, window);

  const attributeCardinality = useMemo(() => {
    // Count distinct values per attribute, capping at max+1 so high-cardinality
    // identifiers can still be excluded by resolveMetricFacets.
    const values = new Map<string, Set<string>>();
    for (const dp of rangeDataPoints) {
      for (const [k, v] of Object.entries(dp.attributes)) {
        if (v === undefined || v === null) continue;
        let set = values.get(k);
        if (!set) {
          set = new Set<string>();
          values.set(k, set);
        }
        if (set.size > 20) continue;
        set.add(typeof v === "string" ? v : JSON.stringify(v));
      }
    }
    const counts = new Map<string, number>();
    for (const [k, s] of values) counts.set(k, s.size);
    return counts;
  }, [rangeDataPoints]);

  const facets = useMemo(
    () => resolveMetricFacets(metric.name, attributeCardinality),
    [metric.name, attributeCardinality],
  );

  const [pickedId, setPickedId] = useState<string | null>(null);
  const effectiveFacet = useMemo<MetricFacet | null>(() => {
    if (pickedId === ALL_FACET) return null;
    if (pickedId) {
      const match = facets.find((f) => facetId(f) === pickedId);
      if (match) return match;
    }
    return facets[0] ?? null;
  }, [pickedId, facets]);

  const tabValue =
    pickedId === ALL_FACET ? ALL_FACET : effectiveFacet ? facetId(effectiveFacet) : ALL_FACET;

  const aggregatedSeries = useMetricAggregateSeries(metric, effectiveFacet, window);

  // MetricSummary/DataPointsTable only read a metric's identity/display
  // fields (name/type/unit/description/resource) plus their own
  // rangeDataPoints/aggregatedSeries props, never metric.dataPoints directly
  // — so rebuild the object they receive from primitives that stay
  // referentially stable across a WS delivery, instead of the ever-new
  // `metric` object, for the React.memo wrapping on those three to actually
  // take effect. dataPoints is set to rangeDataPoints (already stable) so
  // MetricChart — which reads metric.dataPoints as its range-scoped series,
  // see metric-chart.tsx's Props doc — renders the same range-scoped data
  // the tiles/table below it do.
  const stableMetric = useMemo<MetricData>(
    () => ({
      serviceName: metric.serviceName,
      name: metric.name,
      type: metric.type,
      unit: metric.unit,
      description: metric.description,
      resource: metric.resource,
      dataPoints: rangeDataPoints,
      pointCount: metric.pointCount,
      latestValue: metric.latestValue,
      // Deliberately excluded from the deps below: none of the three memoized
      // consumers read it, and tracking it would re-churn stableMetric's
      // reference on every WS delivery, defeating this whole memoization.
      receivedAt: metric.receivedAt,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      metric.serviceName,
      metric.name,
      metric.type,
      metric.unit,
      metric.description,
      metric.resource,
      metric.pointCount,
      metric.latestValue,
      rangeDataPoints,
    ],
  );

  // Resolving against rangeDataPoints (not metric.dataPoints, which starts
  // empty until a WS delivery — issue #162) rather than storing the
  // DataPoint itself lets the sidebar both work for a point that only ever
  // came from the range fetch AND disappear automatically once the client
  // buffer evicts it or a range change drops the id.
  const [selectedDpId, setSelectedDpId] = useState<string | null>(null);
  const selectedDp = rangeDataPoints.find((dp) => dp.id === selectedDpId) ?? null;

  return (
    <div className="flex flex-1 overflow-hidden">
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {metric.description && (
            <p className="mb-4 text-sm text-muted-foreground">{metric.description}</p>
          )}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Breakdown
              </span>
              <Tabs value={tabValue} onValueChange={setPickedId}>
                <TabsList className="h-8 bg-muted/50">
                  {facets.map((f) => (
                    <TabsTrigger
                      key={facetId(f)}
                      value={facetId(f)}
                      className="h-7 px-3 text-xs data-active:bg-metric/15 data-active:text-metric"
                    >
                      {f.label}
                    </TabsTrigger>
                  ))}
                  <TabsTrigger
                    value={ALL_FACET}
                    className="h-7 px-3 text-xs data-active:bg-metric/15 data-active:text-metric"
                  >
                    All
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <TimeWindowControls
              window={window}
              onWindowChange={setWindow}
              tone="metric"
              size="md"
            />
          </div>

          <MetricSummary
            metric={stableMetric}
            facet={effectiveFacet}
            range={range}
            rangeDataPoints={rangeDataPoints}
            aggregatedSeries={aggregatedSeries}
          />

          <div className="mb-4 rounded-lg border border-border/30 bg-muted/50 p-4">
            <div className="h-[336px]">
              <MetricChart
                metric={stableMetric}
                facet={effectiveFacet}
                window={window}
                aggregatedSeries={aggregatedSeries}
              />
            </div>
          </div>

          {rangeDataPoints.length > 0 && (
            <DataPointsTable
              metric={stableMetric}
              dataPoints={rangeDataPoints}
              selectedId={selectedDpId}
              onSelect={setSelectedDpId}
            />
          )}
        </div>
      </ScrollArea>
      {selectedDp && (
        <div className="w-[420px] border-l border-border/50">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border/50 px-4 py-2">
              <h3 className="text-sm font-semibold text-metric">Data Point Details</h3>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setSelectedDpId(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <DataPointDetail
              dp={selectedDp}
              resource={metric.resource}
              unit={resolveMetricUnit(metric.name, metric.unit)}
              isDistribution={isDistributionMetric(metric.type)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const headCls =
  "px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const numCellCls = "px-3 py-1.5 text-right font-mono text-foreground/70";

function formatDistributionCell(v: number | null | undefined, unit: string): string {
  return v != null ? formatMetricValue(v, unit) : "-";
}

// Memoized so a WS delivery that doesn't move rangeDataPoints/stableMetric
// (both kept reference-stable above) skips re-rendering
// and re-reversing/re-mapping every row.
export const DataPointsTable = memo(function DataPointsTable({
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
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Data Points ({dataPoints.length})
      </h4>
      <div className="max-h-[360px] overflow-auto rounded-md border border-border/30 bg-muted/50">
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
                    {new Date(dp.timestamp).toLocaleTimeString()}
                  </td>
                  {hasAttributes && (
                    <td className="max-w-[250px] truncate px-3 py-1.5 font-mono text-foreground/60">
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
});

export function DataPointDetail({
  dp,
  resource,
  unit,
  isDistribution,
}: {
  dp: DataPoint;
  resource: Record<string, unknown>;
  unit: string;
  isDistribution: boolean;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="animate-slide-up-fade space-y-5 p-4">
        <div className="space-y-2.5">
          <Field label="Timestamp" value={formatTimestamp(dp.timestamp)} mono />
          <Field label="Value" mono value={formatMetricValue(dp.value, unit)} tone="metric" />
          {isDistribution && dp.count != null && (
            <Field label="Count" value={dp.count.toLocaleString()} mono />
          )}
          {isDistribution && dp.sum != null && (
            <Field label="Sum" value={formatMetricValue(dp.sum, unit)} mono />
          )}
          {isDistribution && dp.min != null && (
            <Field label="Min" value={formatMetricValue(dp.min, unit)} mono />
          )}
          {isDistribution && dp.max != null && (
            <Field label="Max" value={formatMetricValue(dp.max, unit)} mono />
          )}
        </div>

        <KVSection title="Attributes" data={dp.attributes} />
        <KVSection title="Resource" data={resource} />
      </div>
    </ScrollArea>
  );
}
