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
  // Fall back to the first facet until the user picks one; if the picked
  // facet is no longer available, fall back too.
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

function DataPointsTable({ metric }: { metric: MetricData }) {
  const hasAttributes = useMemo(
    () => metric.dataPoints.some((dp) => Object.keys(dp.attributes).length > 0),
    [metric.dataPoints],
  );
  // Distribution metrics carry Count/Sum/Min/Max alongside Value. Hide these
  // columns for Gauge/Sum where every cell would be "-".
  const hasDistribution = useMemo(
    () =>
      metric.dataPoints.some(
        (dp) => dp.count != null || dp.sum != null || dp.min != null || dp.max != null,
      ),
    [metric.dataPoints],
  );
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
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Timestamp
              </th>
              {hasAttributes && (
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Attributes
                </th>
              )}
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {hasDistribution ? "Mean" : "Value"}
              </th>
              {hasDistribution && (
                <>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Count
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Sum
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Min
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Max
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {[...metric.dataPoints].reverse().map((dp, i) => (
              <tr
                key={i}
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
                {hasDistribution && (
                  <>
                    <td className="px-3 py-1.5 text-right font-mono text-foreground/70">
                      {dp.count != null ? dp.count.toLocaleString() : "-"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-foreground/70">
                      {dp.sum != null ? formatMetricValue(dp.sum, unit) : "-"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-foreground/70">
                      {dp.min != null ? formatMetricValue(dp.min, unit) : "-"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-foreground/70">
                      {dp.max != null ? formatMetricValue(dp.max, unit) : "-"}
                    </td>
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
