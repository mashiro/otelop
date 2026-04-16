import { useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { selectedMetricAtom } from "@/stores/telemetry";
import { MetricChart, attrKey } from "./metric-chart";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DetailPanel } from "@/components/common/detail-panel";
import { Pill } from "@/components/common/pill";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  facetId,
  isDistributionMetric,
  resolveMetricFacets,
  resolveMetricUnit,
  type MetricFacet,
} from "@/lib/metric-catalog";
import { formatMetricValue } from "@/lib/format-metric";
import type { MetricData } from "@/types/telemetry";

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
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {metric.description && (
            <p className="mb-4 text-sm text-muted-foreground">{metric.description}</p>
          )}

          <ChartSection metric={metric} />

          {metric.dataPoints.length > 0 && <DataPointsTable metric={metric} />}
        </div>
      </ScrollArea>
    </DetailPanel>
  );
}

function ChartSection({ metric }: { metric: MetricData }) {
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

  return (
    <div className="mb-4 rounded-lg border border-border/30 bg-muted/50 p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Breakdown
        </span>
        <Tabs value={tabValue} onValueChange={setPickedId}>
          <TabsList className="h-8 bg-background/60">
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
      <div className="h-[300px]">
        <MetricChart metric={metric} facet={effectiveFacet} />
      </div>
    </div>
  );
}

const headCls =
  "px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const numCellCls = "px-3 py-1.5 text-right font-mono text-foreground/70";

function formatDistributionCell(v: number | null | undefined, unit: string): string {
  return v != null ? formatMetricValue(v, unit) : "-";
}

function DataPointsTable({ metric }: { metric: MetricData }) {
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
            {[...metric.dataPoints].reverse().map((dp) => (
              <tr
                key={`${dp.timestamp}|${attrKey(dp.attributes)}`}
                className="border-b border-border/20 last:border-0 transition-colors hover:bg-metric/5"
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
