import { useAtomValue, useSetAtom } from "jotai";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { selectedMetricAtom } from "@/stores/telemetry";
import { MetricChart } from "./metric-chart";
import { ScrollArea } from "@/components/ui/scroll-area";

export function MetricDetail() {
  const metric = useAtomValue(selectedMetricAtom);
  const setSelected = useSetAtom(selectedMetricAtom);

  if (!metric) return null;

  return (
    <div className="animate-fade-in flex h-full flex-col overflow-hidden rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSelected(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
          <span className="font-semibold text-foreground">{metric.name}</span>
          <span className="rounded-full bg-metric/15 px-2 py-0.5 text-[11px] font-medium text-metric">
            {metric.type}
          </span>
          {metric.unit && (
            <span className="text-xs text-muted-foreground">({metric.unit})</span>
          )}
          <span className="text-xs text-muted-foreground">{metric.serviceName}</span>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {metric.description && (
            <p className="mb-4 text-sm text-muted-foreground">{metric.description}</p>
          )}

          {/* Chart */}
          <div className="mb-4 rounded-lg border border-border/30 bg-background/30 p-4">
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
              <div className="max-h-[200px] overflow-auto rounded-md border border-border/30 bg-background/20">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/30">
                      <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Timestamp
                      </th>
                      <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {metric.dataPoints.map((dp, i) => (
                      <tr
                        key={i}
                        className="border-b border-border/20 last:border-0 transition-colors hover:bg-metric/5"
                      >
                        <td className="px-3 py-1.5 font-mono text-muted-foreground">
                          {new Date(dp.timestamp).toLocaleTimeString()}
                        </td>
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
    </div>
  );
}
