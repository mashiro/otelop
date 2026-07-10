import { useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { X } from "lucide-react";
import { selectedMetricAtom } from "@/stores/telemetry";
import { MetricChart } from "./metric-chart";
import { MetricSummary } from "./metric-summary";
import { attrKey } from "@/lib/metric-stats";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DetailPanel } from "@/components/common/detail-panel";
import { Pill } from "@/components/common/pill";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
// the chart must break down by the same dimension.
function MetricDetailBody({ metric }: { metric: MetricData }) {
  const attributeCardinality = useMemo(() => {
    // Count distinct values per attribute, capping at max+1 so high-cardinality
    // identifiers can still be excluded by resolveMetricFacets.
    const values = new Map<string, Set<string>>();
    for (const dp of metric.dataPoints) {
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
  }, [metric.dataPoints]);

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

  // dataPoints is a ring buffer, so a previously selected id can be evicted;
  // resolving against the live array (rather than storing the DataPoint
  // itself) lets the sidebar disappear automatically once that happens.
  const [selectedDpId, setSelectedDpId] = useState<string | null>(null);
  const selectedDp = metric.dataPoints.find((dp) => dp.id === selectedDpId) ?? null;

  return (
    <div className="flex flex-1 overflow-hidden">
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {metric.description && (
            <p className="mb-4 text-sm text-muted-foreground">{metric.description}</p>
          )}

          <div className="mb-3 flex items-center gap-3">
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

          <MetricSummary metric={metric} facet={effectiveFacet} />

          <div className="mb-4 rounded-lg border border-border/30 bg-muted/50 p-4">
            <div className="h-[336px]">
              <MetricChart metric={metric} facet={effectiveFacet} />
            </div>
          </div>

          {metric.dataPoints.length > 0 && (
            <DataPointsTable metric={metric} selectedId={selectedDpId} onSelect={setSelectedDpId} />
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

export function DataPointsTable({
  metric,
  selectedId,
  onSelect,
}: {
  metric: MetricData;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const hasAttributes = metric.dataPoints.some((dp) => Object.keys(dp.attributes).length > 0);
  const isDistribution = isDistributionMetric(metric.type);
  const unit = resolveMetricUnit(metric.name, metric.unit);

  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Data Points ({metric.dataPoints.length})
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
            {[...metric.dataPoints].reverse().map((dp) => {
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
}

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
