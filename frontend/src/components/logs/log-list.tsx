import { HelpTooltip } from "@/components/common/help-tooltip";
import {
  useSignalQuery,
  useTimeWindow,
  useLogSelection,
  useRelatedSignals,
} from "@/hooks/use-signal-route";
import { LogAddFilter, LogFilterBar } from "./log-filter-bar";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { logsAtom, logCountAtom, renderWindowMaxAtom } from "@/stores/telemetry";
import { createFilteredLogsAtom } from "@/stores/filters";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTimestamp, isZeroId, shortId } from "@/lib/format";
import {
  EventListToolbar,
  EVENT_LIST_TOOLBAR_CLASSNAME,
} from "@/components/filters/event-list-toolbar";
import { ListPanel } from "@/components/common/list-panel";
import { EmptyState, EmptyMatches } from "@/components/common/empty-state";
import { LoadMoreRow } from "@/components/common/load-more-row";
import { BackToLatestRow } from "@/components/common/back-to-latest-row";
import { Badge, BadgeDot } from "@/components/ui/badge";
import { SIGNALS } from "@/lib/signals";
import { severityTone } from "@/lib/tones";
import { useLogListPage } from "@/hooks/use-log-list-page";
import { SIGNAL_PAGE_SIZE } from "@/hooks/use-signal-list-page";
import { useRenderWindow } from "@/hooks/use-render-window";
import { useLoadOlderRows } from "@/hooks/use-load-older-rows";
import type { LogData } from "@/types/telemetry";
import { eventWindowAround } from "@/lib/event-time-window";
import { LogDetail } from "./log-detail";

export function LogList() {
  const allLogs = useAtomValue(logsAtom);
  const logCount = useAtomValue(logCountAtom);
  const { state, search, setText } = useSignalQuery("logs");
  const logs = useAtomValue(useMemo(() => createFilteredLogsAtom(search), [search]));
  const { navigateToTrace } = useRelatedSignals();
  const { log: selectedLog, selectLog: setSelectedLog, showSurroundingLogs } = useLogSelection();
  const [window] = useTimeWindow();
  const page = useLogListPage(window, search);
  const renderWindowMax = useAtomValue(renderWindowMaxAtom);
  const renderWindow = useRenderWindow({
    items: logs,
    getId: (log) => log.id,
    max: renderWindowMax,
    pageSize: SIGNAL_PAGE_SIZE,
    resetKey: page.requestKey,
  });
  const { loadMore: handleLoadMore, canLoadMore } = useLoadOlderRows({
    renderWindow,
    page,
    items: logs,
  });

  if (logCount === 0 && allLogs.length === 0) {
    return <EmptyState signal={SIGNALS.logs} />;
  }

  return (
    <ListPanel
      toolbarClassName={EVENT_LIST_TOOLBAR_CLASSNAME}
      toolbarSecondary={state.filters.length > 0 ? <LogFilterBar /> : null}
      toolbar={
        <EventListToolbar
          searchValue={state.text}
          onSearchSubmit={setText}
          searchPlaceholder="Search logs…"
          addFilter={<LogAddFilter />}
          tone="log"
        />
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
        {logs.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <EmptyMatches label="logs" />
            <LoadMoreRow
              visible={canLoadMore}
              loadingMore={page.loadingMore}
              onClick={handleLoadMore}
            />
          </div>
        ) : (
          <ScrollArea className="min-h-0 min-w-0 flex-1">
            <BackToLatestRow
              count={renderWindow.newerCount}
              label="newer — back to latest"
              onClick={renderWindow.backToLatest}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-27.5" tone="log">
                    Timestamp
                  </TableHead>
                  <TableHead className="w-22.5" tone="log">
                    Severity
                  </TableHead>
                  <TableHead tone="log">Service</TableHead>
                  <TableHead tone="log">Body</TableHead>
                  <TableHead tone="log">Trace ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renderWindow.visible.map((log) => (
                  <LogRow
                    key={log.id}
                    log={log}
                    isSelected={selectedLog?.id === log.id}
                    onSelect={setSelectedLog}
                    onNavigateToTrace={navigateToTrace}
                  />
                ))}
              </TableBody>
            </Table>
            <LoadMoreRow
              visible={canLoadMore}
              loadingMore={page.loadingMore}
              onClick={handleLoadMore}
            />
          </ScrollArea>
        )}
        {selectedLog && (
          <LogDetail
            log={selectedLog}
            onClose={() => setSelectedLog(null)}
            onNavigateToTrace={navigateToTrace}
            onShowContext={() => {
              void showSurroundingLogs(eventWindowAround(selectedLog.timestamp, window));
            }}
          />
        )}
      </div>
    </ListPanel>
  );
}

interface LogRowProps {
  log: LogData;
  isSelected: boolean;
  onSelect: (log: LogData | null) => void;
  onNavigateToTrace: (traceId: string) => void;
}

// Row bail-out is provided by React Compiler.
function LogRow({ log, isSelected, onSelect, onNavigateToTrace }: LogRowProps) {
  const hasTrace = !isZeroId(log.traceId);
  return (
    <TableRow
      tone="log"
      interactive
      stagger
      selected={isSelected}
      onClick={() => onSelect(isSelected ? null : log)}
    >
      <TableCell variant="mono" emphasis="muted">
        {formatTimestamp(log.timestamp)}
      </TableCell>
      <TableCell>
        <Badge variant="soft" size="sm" tone={severityTone(log.severityText)}>
          <BadgeDot />
          {log.severityText || "UNSET"}
        </Badge>
      </TableCell>
      <TableCell emphasis="strong">{log.serviceName || "-"}</TableCell>
      <TableCell emphasis="secondary" truncate className="max-w-100">
        {log.body}
      </TableCell>
      <TableCell>
        {hasTrace ? (
          <HelpTooltip content="View trace">
            <button
              aria-label={`View trace ${log.traceId}`}
              className="font-mono text-xs text-trace underline decoration-trace/30 underline-offset-2 transition-colors hover:text-trace hover:decoration-trace/60"
              onClick={(e) => {
                e.stopPropagation();
                onNavigateToTrace(log.traceId);
              }}
            >
              {shortId(log.traceId, 8)}
            </button>
          </HelpTooltip>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
