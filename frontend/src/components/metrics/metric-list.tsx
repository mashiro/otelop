import { useAtomValue } from "jotai";
import { metricsAtom } from "@/stores/telemetry";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/format";

export function MetricList() {
  const metrics = useAtomValue(metricsAtom);

  if (metrics.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No metrics yet. Send OTLP data to see them here.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Points</TableHead>
            <TableHead className="text-right">Latest Value</TableHead>
            <TableHead>Received</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {metrics.map((metric, i) => {
            const lastPoint = metric.dataPoints[metric.dataPoints.length - 1];
            return (
              <TableRow key={`${metric.name}-${i}`}>
                <TableCell className="font-medium">{metric.serviceName || "-"}</TableCell>
                <TableCell>{metric.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{metric.type}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{metric.unit || "-"}</TableCell>
                <TableCell className="text-right">{metric.dataPoints.length}</TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {lastPoint ? lastPoint.value.toLocaleString() : "-"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatRelativeTime(metric.receivedAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
