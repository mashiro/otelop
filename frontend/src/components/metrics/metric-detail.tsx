import { useMemo } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { selectedMetricAtom } from "@/stores/telemetry";
import { MetricChart, attrKey } from "./metric-chart";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DetailPanel } from "@/components/common/detail-panel";
import { Pill } from "@/components/common/pill";

export function MetricDetail() {
  const metric = useAtomValue(selectedMetricAtom);
  const setSelected = useSetAtom(selectedMetricAtom);

  const hasAttributes = useMemo(
    () => metric?.dataPoints.some((dp) => Object.keys(dp.attributes).length > 0) ?? false,
    [metric],
  );

  if (!metric) return null;

  return (
    <DetailPanel
      onClose={() => setSelected(null)}
      header={
        <>
          <span className="font-semibold text-foreground">{metric.name}</span>
          <Pill tone="metric">{metric.type}</Pill>
          {metric.unit && <span className="text-xs text-muted-foreground">({metric.unit})</span>}
          <span className="text-xs text-muted-foreground">{metric.serviceName}</span>
        </>
      }
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {metric.description && (
            <p className="mb-4 text-sm text-muted-foreground">{metric.description}</p>
          )}

          {/* Chart */}
          <div className="mb-4 rounded-lg border border-border/30 bg-muted/50 p-4">
            <div className="h-[300px]">
              <MetricChart metric={metric} />
            </div>
          </div>

          {/* Data points table */}
          {metric.dataPoints.length > 0 && (
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
                        Value
                      </th>
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
                          {dp.value.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </DetailPanel>
  );
}
