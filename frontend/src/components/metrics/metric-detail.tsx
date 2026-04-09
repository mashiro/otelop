import { useAtomValue, useSetAtom } from "jotai";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { selectedMetricAtom } from "@/stores/telemetry";
import { MetricChart } from "./metric-chart";

export function MetricDetail() {
  const metric = useAtomValue(selectedMetricAtom);
  const setSelected = useSetAtom(selectedMetricAtom);

  if (!metric) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
            <X className="h-4 w-4" />
          </Button>
          <span className="font-semibold">{metric.name}</span>
          <Badge variant="secondary">{metric.type}</Badge>
          {metric.unit && <span className="text-xs text-muted-foreground">({metric.unit})</span>}
          <span className="text-xs text-muted-foreground">{metric.serviceName}</span>
        </div>
      </div>
      <div className="flex-1 overflow-hidden p-4">
        {metric.description && (
          <p className="mb-4 text-sm text-muted-foreground">{metric.description}</p>
        )}
        <div className="h-[300px]">
          <MetricChart metric={metric} />
        </div>
        {metric.dataPoints.length > 0 && (
          <div className="mt-4">
            <h4 className="mb-2 text-sm font-semibold text-muted-foreground">
              Data Points ({metric.dataPoints.length})
            </h4>
            <div className="max-h-[200px] overflow-auto rounded border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-2 py-1 text-left">Timestamp</th>
                    <th className="px-2 py-1 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {metric.dataPoints.map((dp, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-2 py-1 font-mono">
                        {new Date(dp.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
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
    </div>
  );
}
