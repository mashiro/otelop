import { useState } from "react";
import { useAtomValue } from "jotai";
import { logsAtom } from "@/stores/telemetry";
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
import { formatTimestamp, isZeroID, shortID } from "@/lib/format";
import type { LogData } from "@/types/telemetry";

const severityColor: Record<string, string> = {
  TRACE: "secondary",
  DEBUG: "secondary",
  INFO: "default",
  WARN: "outline",
  ERROR: "destructive",
  FATAL: "destructive",
};

export function LogList() {
  const logs = useAtomValue(logsAtom);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (logs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No logs yet. Send OTLP data to see them here.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[110px]">Timestamp</TableHead>
            <TableHead className="w-[80px]">Severity</TableHead>
            <TableHead>Service</TableHead>
            <TableHead>Body</TableHead>
            <TableHead>Trace ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log, i) => (
            <>
              <TableRow
                key={`row-${i}`}
                className="cursor-pointer"
                onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
              >
                <TableCell className="font-mono text-xs">
                  {formatTimestamp(log.timestamp)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      (severityColor[log.severityText] ?? "secondary") as
                        | "default"
                        | "secondary"
                        | "destructive"
                        | "outline"
                    }
                  >
                    {log.severityText || "UNSET"}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{log.serviceName || "-"}</TableCell>
                <TableCell className="max-w-[400px] truncate text-sm">{log.body}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {isZeroID(log.traceID) ? "" : shortID(log.traceID, 8)}
                </TableCell>
              </TableRow>
              {expandedIdx === i && (
                <TableRow key={`detail-${i}`}>
                  <TableCell colSpan={5} className="bg-muted/30 p-0">
                    <LogDetail log={log} />
                  </TableCell>
                </TableRow>
              )}
            </>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

function LogDetail({ log }: { log: LogData }) {
  return (
    <div className="space-y-3 px-4 py-3 text-xs">
      <div>
        <span className="font-semibold text-muted-foreground">Body: </span>
        <span className="whitespace-pre-wrap break-all">{log.body}</span>
      </div>
      {!isZeroID(log.traceID) && (
        <div>
          <span className="font-semibold text-muted-foreground">Trace ID: </span>
          <span className="font-mono">{log.traceID}</span>
          {!isZeroID(log.spanID) && (
            <>
              {" / Span ID: "}
              <span className="font-mono">{log.spanID}</span>
            </>
          )}
        </div>
      )}
      {Object.keys(log.attributes).length > 0 && (
        <div>
          <div className="mb-1 font-semibold text-muted-foreground">Attributes</div>
          <div className="space-y-0.5">
            {Object.entries(log.attributes).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="shrink-0 text-muted-foreground">{k}</span>
                <span className="font-mono break-all">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {Object.keys(log.resource).length > 0 && (
        <div>
          <div className="mb-1 font-semibold text-muted-foreground">Resource</div>
          <div className="space-y-0.5">
            {Object.entries(log.resource).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="shrink-0 text-muted-foreground">{k}</span>
                <span className="font-mono break-all">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
