import { useAtomValue, useSetAtom } from "jotai";
import { tracesAtom, selectedTraceAtom } from "@/stores/telemetry";
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
import { formatDuration, formatRelativeTime, shortID } from "@/lib/format";
import { TraceDetail } from "./trace-detail";

export function TraceList() {
  const traces = useAtomValue(tracesAtom);
  const selectedTrace = useAtomValue(selectedTraceAtom);
  const setSelectedTrace = useSetAtom(selectedTraceAtom);

  if (selectedTrace) {
    return <TraceDetail />;
  }

  if (traces.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No traces yet. Send OTLP data to see them here.
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
            <TableHead>Trace ID</TableHead>
            <TableHead className="text-right">Spans</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {traces.map((trace) => {
            const status = trace.rootSpan?.statusCode ?? "Unset";
            return (
              <TableRow
                key={trace.traceID}
                className="cursor-pointer"
                onClick={() => setSelectedTrace(trace)}
              >
                <TableCell className="font-medium">{trace.serviceName || "-"}</TableCell>
                <TableCell>{trace.rootSpan?.name ?? trace.spans[0]?.name ?? "-"}</TableCell>
                <TableCell className="font-mono text-xs">{shortID(trace.traceID)}</TableCell>
                <TableCell className="text-right">{trace.spanCount}</TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatDuration(trace.duration)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatRelativeTime(trace.startTime)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={status} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "Ok")
    return (
      <Badge variant="outline" className="border-green-500 text-green-600">
        Ok
      </Badge>
    );
  if (status === "Error") return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="secondary">Unset</Badge>;
}
