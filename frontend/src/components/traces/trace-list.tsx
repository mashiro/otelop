import { useAtomValue, useSetAtom } from "jotai";
import { tracesAtom, selectedTraceAtom } from "@/stores/telemetry";
import { filteredTracesAtom } from "@/stores/filters";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TraceFilters } from "@/components/filters/trace-filters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, formatRelativeTime, shortID } from "@/lib/format";
import { TraceDetail } from "./trace-detail";

export function TraceList() {
  const allTraces = useAtomValue(tracesAtom);
  const traces = useAtomValue(filteredTracesAtom);
  const selectedTrace = useAtomValue(selectedTraceAtom);
  const setSelectedTrace = useSetAtom(selectedTraceAtom);

  if (selectedTrace) {
    return <TraceDetail />;
  }

  if (allTraces.length === 0) {
    return (
      <div className="glass-card flex h-full items-center justify-center">
        <div className="animate-slide-up-fade flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-trace/10">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--trace)"
              strokeWidth="1.5"
            >
              <path d="M3 12h4l3-9 4 18 3-9h4" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground/70">No traces yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Send OTLP data to see them here</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card flex h-full flex-col overflow-hidden">
      <TraceFilters />
      {traces.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">No matching traces</p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50 hover:bg-transparent">
                <TableHead className="text-trace/70">Service</TableHead>
                <TableHead className="text-trace/70">Name</TableHead>
                <TableHead className="text-trace/70">Trace ID</TableHead>
                <TableHead className="text-right text-trace/70">Spans</TableHead>
                <TableHead className="text-right text-trace/70">Duration</TableHead>
                <TableHead className="text-trace/70">Started</TableHead>
                <TableHead className="text-trace/70">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traces.map((trace, idx) => {
                const status = trace.rootSpan?.statusCode ?? "Unset";
                return (
                  <TableRow
                    key={trace.traceID}
                    className="stagger-row cursor-pointer border-b border-border/30 transition-colors hover:bg-trace/5"
                    style={{ animationDelay: `${Math.min(idx * 20, 200)}ms` }}
                    onClick={() => setSelectedTrace(trace)}
                  >
                    <TableCell className="font-medium">{trace.serviceName || "-"}</TableCell>
                    <TableCell className="text-foreground/80">
                      {trace.rootSpan?.name ?? trace.spans[0]?.name ?? "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {shortID(trace.traceID)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {trace.spanCount}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-trace">
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
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "Ok")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        Ok
      </span>
    );
  if (status === "Error")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        Error
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
      Unset
    </span>
  );
}
