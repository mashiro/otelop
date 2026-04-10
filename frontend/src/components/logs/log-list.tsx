import { Fragment, useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Copy, Check } from "lucide-react";
import { logsAtom, logTraceFilterAtom, navigateToTraceAtom } from "@/stores/telemetry";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatTimestamp, isZeroID, shortID } from "@/lib/format";
import { KVSection } from "@/components/ui/kv-section";
import { useCopyJson } from "@/hooks/use-copy";
import type { LogData } from "@/types/telemetry";

const severityStyle: Record<string, { bg: string; text: string; dot: string }> = {
  TRACE: { bg: "bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground/40" },
  DEBUG: { bg: "bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground/40" },
  INFO: { bg: "bg-primary/15", text: "text-primary", dot: "bg-primary" },
  WARN: { bg: "bg-warning/15", text: "text-warning", dot: "bg-warning" },
  ERROR: { bg: "bg-destructive/15", text: "text-destructive", dot: "bg-destructive" },
  FATAL: { bg: "bg-destructive/20", text: "text-destructive", dot: "bg-destructive" },
};

const defaultSeverity = {
  bg: "bg-muted",
  text: "text-muted-foreground",
  dot: "bg-muted-foreground/40",
};

export function LogList() {
  const allLogs = useAtomValue(logsAtom);
  const traceFilter = useAtomValue(logTraceFilterAtom);
  const setTraceFilter = useSetAtom(logTraceFilterAtom);
  const navigateToTrace = useSetAtom(navigateToTraceAtom);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const logs = useMemo(
    () => (traceFilter ? allLogs.filter((l) => l.traceID === traceFilter) : allLogs),
    [allLogs, traceFilter],
  );

  if (allLogs.length === 0) {
    return (
      <div className="glass-card flex h-full items-center justify-center">
        <div className="animate-slide-up-fade flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-log/10">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--log)"
              strokeWidth="1.5"
            >
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground/70">No logs yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Send OTLP data to see them here</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card flex h-full flex-col overflow-hidden">
      {/* Filter bar */}
      {traceFilter && (
        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Filtered by Trace
          </span>
          <span className="rounded bg-trace/15 px-1.5 py-0.5 font-mono text-xs text-trace">
            {shortID(traceFilter)}
          </span>
          <button
            onClick={() => setTraceFilter(null)}
            className="ml-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Clear
          </button>
          <span className="text-xs text-muted-foreground">
            {logs.length} / {allLogs.length} logs
          </span>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border/50 hover:bg-transparent">
              <TableHead className="w-[110px] text-log/70">Timestamp</TableHead>
              <TableHead className="w-[90px] text-log/70">Severity</TableHead>
              <TableHead className="text-log/70">Service</TableHead>
              <TableHead className="text-log/70">Body</TableHead>
              <TableHead className="text-log/70">Trace ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log, i) => {
              const style = severityStyle[log.severityText] ?? defaultSeverity;
              const hasTrace = !isZeroID(log.traceID);
              return (
                <Fragment key={i}>
                  <TableRow
                    className="stagger-row cursor-pointer border-b border-border/30 transition-colors hover:bg-log/5"
                    style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}
                    onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {formatTimestamp(log.timestamp)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.text}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                        {log.severityText || "UNSET"}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{log.serviceName || "-"}</TableCell>
                    <TableCell className="max-w-[400px] truncate text-sm text-foreground/80">
                      {log.body}
                    </TableCell>
                    <TableCell>
                      {hasTrace ? (
                        <button
                          className="font-mono text-xs text-trace underline decoration-trace/30 underline-offset-2 transition-colors hover:text-trace hover:decoration-trace/60"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigateToTrace(log.traceID);
                          }}
                          title="View trace"
                        >
                          {shortID(log.traceID, 8)}
                        </button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                  {expandedIdx === i && (
                    <TableRow key={`detail-${i}`}>
                      <TableCell
                        colSpan={5}
                        className="whitespace-normal border-b border-border/20 bg-card/30 p-0"
                      >
                        <LogDetail log={log} onNavigateToTrace={navigateToTrace} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}

function LogDetail({
  log,
  onNavigateToTrace,
}: {
  log: LogData;
  onNavigateToTrace: (id: string) => void;
}) {
  const { copied, copy } = useCopyJson();

  return (
    <div className="animate-slide-up-fade space-y-3 overflow-hidden px-4 py-3 text-xs">
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => copy(log)}
          className="gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          title="Copy log as JSON"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Body
        </div>
        <div className="whitespace-pre-wrap break-all font-mono text-foreground/80 pl-3">
          {log.body}
        </div>
      </div>
      {!isZeroID(log.traceID) && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Trace ID{" "}
          </span>
          <button
            className="font-mono text-trace underline decoration-trace/30 underline-offset-2 transition-colors hover:decoration-trace/60"
            onClick={() => onNavigateToTrace(log.traceID)}
          >
            {log.traceID}
          </button>
          {!isZeroID(log.spanID) && (
            <>
              <span className="mx-1 text-muted-foreground">/</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Span ID{" "}
              </span>
              <span className="font-mono text-log">{log.spanID}</span>
            </>
          )}
        </div>
      )}
      <KVSection title="Attributes" data={log.attributes} />
      <KVSection title="Resource" data={log.resource} />
    </div>
  );
}
