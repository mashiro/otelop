import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";
import { useMetricSelection, useTimeWindow } from "@/hooks/use-signal-route";
import { MetricChart } from "./metric-chart";
import { MetricSummary } from "./metric-summary";
import { DataPointsTable } from "./data-points-table";
import { DataPointDetail } from "./data-point-detail";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CopyJsonButton } from "@/components/common/copy-json-button";
import { DetailPanel } from "@/components/common/detail-panel";
import { DetailSidebar } from "@/components/common/detail-sidebar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimeWindowControls } from "@/components/common/event-window-controls";
import {
  computeAttributeCardinality,
  facetId,
  isDistributionMetric,
  resolveMetricFacets,
  resolveMetricUnit,
  type MetricFacet,
} from "@/lib/metric-catalog";
import { useMetricRangePoints } from "@/hooks/use-metric-range-points";
import { useMetricAggregateSeries } from "@/hooks/use-metric-aggregate-series";
import { useMetricDistributionStats } from "@/hooks/use-metric-distribution-stats";
import type { MetricData } from "@/types/telemetry";

const ALL_FACET = "__all__";

export function MetricDetail() {
  const { metric, selectMetric: setSelected } = useMetricSelection();

  if (!metric) return null;

  const displayUnit = resolveMetricUnit(metric.name, metric.unit);
  const onClose = () => setSelected(null);

  return (
    <DetailPanel
      onClose={onClose}
      header={
        <>
          <span className="font-semibold text-foreground">{metric.name}</span>
          <Badge variant="soft" size="sm" tone="metric">
            {metric.type}
          </Badge>
          {displayUnit && <span className="text-xs text-muted-foreground">({displayUnit})</span>}
          <span className="text-xs text-muted-foreground">{metric.serviceName}</span>
        </>
      }
    >
      <MetricDetailBody metric={metric} />
    </DetailPanel>
  );
}

// Resolves the facet tab a picked id currently maps to: an explicit "All"
// pick, a match against the current facet list, or the first facet as the
// default (facets can reorder/change as data arrives, so pickedId is an id to
// re-resolve, not a stored MetricFacet).
function resolveEffectiveFacet(pickedId: string | null, facets: MetricFacet[]): MetricFacet | null {
  if (pickedId === ALL_FACET) return null;
  if (pickedId) {
    const match = facets.find((f) => facetId(f) === pickedId);
    if (match) return match;
  }
  return facets[0] ?? null;
}

// Facet selection lives here (not in the chart) because the summary tiles and
// the chart must break down by the same dimension. Exported for direct
// testing (see metric-detail.test.tsx), the same way DataPointsTable/
// DataPointDetail are, so tests can supply a metric directly.
export function MetricDetailBody({ metric }: { metric: MetricData }) {
  const [selectedDpId, setSelectedDpId] = useState<string | null>(null);

  // Time range is the scope for the whole detail view (tiles, chart, and
  // table all read the same window), so it's lifted here rather than owned
  // by MetricChart — see metric-stats.ts's computeStatTiles. Defaults to a
  // recent window rather than "all": DuckDB history is fetched on demand, so
  // opening a long-lived metric shouldn't eagerly pull its full retention.
  // Synced to the URL (unlike pickedId below) so a shared/reloaded link
  // reopens the same window.
  const [window, setWindow] = useTimeWindow();
  // rangeDataPoints (the fetched-range + live-buffer merge, already stable by
  // id — see use-metric-range-points.ts) is the source of truth for
  // everything below, not metric.dataPoints: the metrics list's initial load
  // no longer populates dataPoints (issue #162), so a metric opened before
  // its first WS delivery would otherwise show no facets/table/selectable
  // rows despite its history already being fetched.
  const rangeDataPoints = useMetricRangePoints(metric, window);

  const attributeCardinality = computeAttributeCardinality(rangeDataPoints);
  const facets = resolveMetricFacets(metric.name, attributeCardinality);

  const [pickedId, setPickedId] = useState<string | null>(null);
  const effectiveFacet = resolveEffectiveFacet(pickedId, facets);

  const tabValue =
    pickedId === ALL_FACET ? ALL_FACET : effectiveFacet ? facetId(effectiveFacet) : ALL_FACET;

  const aggregatedSeries = useMetricAggregateSeries(metric, effectiveFacet, window);
  const distributionGroupBy = effectiveFacet?.attributes ?? null;
  const distributionStats = useMetricDistributionStats(metric, window, distributionGroupBy);

  // Resolving against rangeDataPoints (not metric.dataPoints, which starts
  // empty until a WS delivery — issue #162) rather than storing the
  // DataPoint itself lets the sidebar both work for a point that only ever
  // came from the range fetch AND disappear automatically once the client
  // buffer evicts it or a range change drops the id.
  const selectedDp = rangeDataPoints.find((dp) => dp.id === selectedDpId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div className="p-4">
          {metric.description && (
            <p className="mb-4 text-sm text-muted-foreground">{metric.description}</p>
          )}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
                Breakdown
              </span>
              <Tabs value={tabValue} onValueChange={setPickedId}>
                <TabsList>
                  {facets.map((f) => (
                    <TabsTrigger key={facetId(f)} value={facetId(f)} tone="metric">
                      {f.label}
                    </TabsTrigger>
                  ))}
                  <TabsTrigger value={ALL_FACET} tone="metric">
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
            metric={metric}
            facet={effectiveFacet}
            window={window}
            rangeDataPoints={rangeDataPoints}
            aggregatedSeries={aggregatedSeries}
            distributionStats={distributionStats}
            distributionGroupBy={distributionGroupBy}
          />

          <Card className="mb-4">
            <CardContent className="h-84">
              <MetricChart
                metric={{ ...metric, dataPoints: rangeDataPoints }}
                facet={effectiveFacet}
                window={window}
                aggregatedSeries={aggregatedSeries}
                onWindowChange={setWindow}
              />
            </CardContent>
          </Card>

          {rangeDataPoints.length > 0 && (
            <DataPointsTable
              metric={metric}
              dataPoints={rangeDataPoints}
              selectedId={selectedDpId}
              onSelect={setSelectedDpId}
            />
          )}
        </div>
      </ScrollArea>
      {selectedDp && (
        <DetailSidebar
          title="Data Point Details"
          tone="metric"
          onClose={() => setSelectedDpId(null)}
          closeLabel="Close data point details"
          actions={<CopyJsonButton data={selectedDp} />}
        >
          <DataPointDetail
            dp={selectedDp}
            resource={metric.resource}
            unit={resolveMetricUnit(metric.name, metric.unit)}
            isDistribution={isDistributionMetric(metric.type)}
          />
        </DetailSidebar>
      )}
    </div>
  );
}
