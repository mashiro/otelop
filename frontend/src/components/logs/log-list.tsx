import { Fragment, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { X } from "lucide-react";
import { logsAtom, logTraceFilterAtom, navigateToTraceAtom } from "@/stores/telemetry";
import { filteredLogsAtom, logSearchAtom } from "@/stores/filters";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CopyJsonButton } from "@/components/ui/copy-json-button";
import { formatTimestamp, isZeroID, shortID } from "@/lib/format";
import { KVSection } from "@/components/ui/kv-section";
import { SearchFilter } from "@/components/filters/search-filter";
import { ListPanel } from "@/components/common/list-panel";
import { EmptyState, EmptyMatches } from "@/components/common/empty-state";
import { Pill } from "@/components/common/pill";
import { SIGNALS } from "@/lib/signals";
import { severityTone } from "@/lib/tones";
import type { LogData } from "@/types/telemetry";

export function LogList() {
  const allLogs = useAtomValue(logsAtom);
  const logs = useAtomValue(filteredLogsAtom);
  const traceFilter = useAtomValue(logTraceFilterAtom);
  const setTraceFilter = useSetAtom(logTraceFilterAtom);
  const navigateToTrace = useSetAtom(navigateToTraceAtom);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (allLogs.length === 0) {
    return <EmptyState signal={SIGNALS.logs} />;
  }

  return (
    <ListPanel
      toolbar={
        <>
          {traceFilter && (
            <div className="flex items-center gap-1 rounded bg-trace/10 px-2 py-0.5 text-[11px] text-trace">
              <span className="font-mono">{traceFilter.slice(0, 12)}...</span>
              <button
                type="button"
                onClick={() => setTraceFilter(null)}
                className="text-trace hover:text-foreground"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
          <SearchFilter atom={logSearchAtom} placeholder="Search logs..." />
        </>
      }
    >
      {logs.length === 0 ? (
        <EmptyMatches label="logs" />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50 bg-muted hover:bg-muted">
                <TableHead className="w-[110px] text-log/70">Timestamp</TableHead>
                <TableHead className="w-[90px] text-log/70">Severity</TableHead>
                <TableHead className="text-log/70">Service</TableHead>
                <TableHead className="text-log/70">Body</TableHead>
                <TableHead className="text-log/70">Trace ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log, i) => {
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
                        <Pill tone={severityTone(log.severityText)} dot>
                          {log.severityText || "UNSET"}
                        </Pill>
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
      )}
    </ListPanel>
  );
}

function LogDetail({
  log,
  onNavigateToTrace,
}: {
  log: LogData;
  onNavigateToTrace: (id: string) => void;
}) {
  return (
    <div className="animate-slide-up-fade relative space-y-3 overflow-hidden px-4 py-3 text-xs">
      <div className="absolute right-3 top-2">
        <CopyJsonButton data={log} size="xs" />
      </div>
      <div className="whitespace-pre-wrap break-all pr-20 font-mono text-foreground/80">
        {log.body}
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
