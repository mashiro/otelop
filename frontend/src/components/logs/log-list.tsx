import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { X } from "lucide-react";
import {
  logsAtom,
  logCountAtom,
  logTraceFilterAtom,
  navigateToTraceAtom,
  selectedLogAtom,
} from "@/stores/telemetry";
import { eventTimeWindowAtom } from "@/stores/navigation";
import { filteredLogsAtom, logSearchAtom } from "@/stores/filters";
import { Button } from "@/components/ui/button";
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
import { formatTimestamp, isZeroId, shortId } from "@/lib/format";
import { KVSection } from "@/components/ui/kv-section";
import { Field, Section } from "@/components/common/detail-field";
import { SearchFilter } from "@/components/filters/search-filter";
import { ListPanel } from "@/components/common/list-panel";
import { EmptyState, EmptyMatches } from "@/components/common/empty-state";
import { EventWindowControls } from "@/components/common/event-window-controls";
import { LoadMoreRow } from "@/components/common/load-more-row";
import { Pill } from "@/components/common/pill";
import { SIGNALS } from "@/lib/signals";
import { severityTone } from "@/lib/tones";
import { useLogListPage } from "@/hooks/use-log-list-page";
import type { LogData } from "@/types/telemetry";
import { eventWindowAround } from "@/lib/event-time-window";

export function LogList() {
  const allLogs = useAtomValue(logsAtom);
  const logCount = useAtomValue(logCountAtom);
  const logs = useAtomValue(filteredLogsAtom);
  const traceFilter = useAtomValue(logTraceFilterAtom);
  const setTraceFilter = useSetAtom(logTraceFilterAtom);
  const navigateToTrace = useSetAtom(navigateToTraceAtom);
  const selectedLog = useAtomValue(selectedLogAtom);
  const setSelectedLog = useSetAtom(selectedLogAtom);
  const [window, setWindow] = useAtom(eventTimeWindowAtom);
  const [search, setSearch] = useAtom(logSearchAtom);
  const page = useLogListPage(window, search, traceFilter);

  if (logCount === 0 && allLogs.length === 0) {
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
          <SearchFilter atom={logSearchAtom} placeholder="Search logs…" />
          <div className="ml-auto px-3">
            <EventWindowControls tone="log" allRetained={Boolean(search.trim() || traceFilter)} />
          </div>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {logs.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <EmptyMatches label="logs" />
            <LoadMoreRow {...page} />
          </div>
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
                  const hasTrace = !isZeroId(log.traceId);
                  const isSelected = selectedLog?.id === log.id;
                  return (
                    <TableRow
                      key={log.id}
                      className={`stagger-row cursor-pointer border-b border-border/30 transition-colors hover:bg-log/5 ${isSelected ? "bg-log/10" : ""}`}
                      style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}
                      onClick={() => setSelectedLog(isSelected ? null : log)}
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
                              navigateToTrace(log.traceId);
                            }}
                            title="View trace"
                          >
                            {shortId(log.traceId, 8)}
                          </button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <LoadMoreRow {...page} />
          </ScrollArea>
        )}
        {selectedLog && (
          <div className="w-[420px] border-l border-border/50">
            <LogDetail
              log={selectedLog}
              onClose={() => setSelectedLog(null)}
              onNavigateToTrace={navigateToTrace}
              onShowContext={() => {
                setSearch("");
                setWindow(eventWindowAround(selectedLog.timestamp, window));
              }}
            />
          </div>
        )}
      </div>
    </ListPanel>
  );
}

function LogDetail({
  log,
  onClose,
  onNavigateToTrace,
  onShowContext,
}: {
  log: LogData;
  onClose: () => void;
  onNavigateToTrace: (id: string) => void;
  onShowContext: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2">
        <h3 className="text-sm font-semibold text-log">Log Details</h3>
        <div className="flex items-center gap-1">
          <CopyJsonButton data={log} size="xs" />
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="animate-slide-up-fade space-y-5 p-4">
          <div className="space-y-2.5">
            <Button variant="outline" size="sm" onClick={onShowContext} className="w-full">
              Show surrounding logs
            </Button>
            <Field label="Timestamp" value={formatTimestamp(log.timestamp)} mono />
            <Field
              label="Severity"
              value={
                <Pill tone={severityTone(log.severityText)} dot>
                  {log.severityText || "UNSET"}
                </Pill>
              }
            />
            <Field label="Service" value={log.serviceName || "-"} />
            {!isZeroId(log.traceId) && (
              <Field
                label="Trace ID"
                mono
                value={
                  <button
                    className="text-trace underline decoration-trace/30 underline-offset-2 transition-colors hover:decoration-trace/60"
                    onClick={() => onNavigateToTrace(log.traceId)}
                  >
                    {log.traceId}
                  </button>
                }
              />
            )}
            {!isZeroId(log.spanId) && <Field label="Span ID" value={log.spanId} mono />}
          </div>

          <Section title="Body">
            <div className="whitespace-pre-wrap break-all font-mono text-xs text-foreground/80">
              {log.body}
            </div>
          </Section>

          <KVSection title="Attributes" data={log.attributes} />

          <KVSection title="Resource" data={log.resource} />
        </div>
      </ScrollArea>
    </div>
  );
}
