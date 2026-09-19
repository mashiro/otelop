import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import {
  useSignalQuery,
  useTimeWindow,
  useLogSelection,
  useRelatedSignals,
} from "@/hooks/use-signal-route";
import { useFilterByAction } from "@/hooks/use-filter-by-action";
import { LogAddFilter, LogFilterBar } from "./log-filter-bar";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { Logs } from "lucide-react";
import { logsAtom, logCountAtom, renderWindowMaxAtom } from "@/stores/telemetry";
import { createFilteredLogsAtom } from "@/stores/filters";
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
import { DetailSidebar } from "@/components/common/detail-sidebar";
import {
  EventListToolbar,
  EVENT_LIST_TOOLBAR_CLASSNAME,
} from "@/components/filters/event-list-toolbar";
import { ListPanel } from "@/components/common/list-panel";
import { EmptyState, EmptyMatches } from "@/components/common/empty-state";
import { LoadMoreRow } from "@/components/common/load-more-row";
import { BackToLatestRow } from "@/components/common/back-to-latest-row";
import { Pill } from "@/components/common/pill";
import { SIGNALS } from "@/lib/signals";
import { severityTone } from "@/lib/tones";
import { useLogListPage } from "@/hooks/use-log-list-page";
import { SIGNAL_PAGE_SIZE } from "@/hooks/use-signal-list-page";
import { useRenderWindow } from "@/hooks/use-render-window";
import { useLoadOlderRows } from "@/hooks/use-load-older-rows";
import type { LogData } from "@/types/telemetry";
import { eventWindowAround } from "@/lib/event-time-window";

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
        <Pill tone={severityTone(log.severityText)} dot>
          {log.severityText || "UNSET"}
        </Pill>
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
  useKeyboardShortcut("Escape", onClose);
  const { filterBy, filterAction } = useFilterByAction("logs");
  return (
    <DetailSidebar
      title="Log Details"
      tone="log"
      onClose={onClose}
      actions={<CopyJsonButton data={log} size="xs" />}
    >
      <div className="space-y-2.5">
        <Field
          label="Timestamp"
          value={formatTimestamp(log.timestamp)}
          mono
          action={
            <HelpTooltip content="Show surrounding logs">
              <Button
                variant="ghost-muted"
                size="icon-xs"
                onClick={onShowContext}
                aria-label="Show surrounding logs"
              >
                <Logs />
              </Button>
            </HelpTooltip>
          }
        />
        <Field
          label="Severity"
          action={filterAction("severity_number", log.severityNumber)}
          value={
            <Pill tone={severityTone(log.severityText)} dot>
              {log.severityText || "UNSET"}
            </Pill>
          }
        />
        <Field
          label="Service"
          value={log.serviceName || "-"}
          action={filterAction("service_name", log.serviceName)}
        />
        {!isZeroId(log.traceId) && (
          <Field
            label="Trace ID"
            action={filterAction("trace_id", log.traceId)}
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
        {!isZeroId(log.spanId) && (
          <Field
            label="Span ID"
            value={log.spanId}
            mono
            action={filterAction("span_id", log.spanId)}
          />
        )}
      </div>

      <Section title="Body" action={filterAction("body", log.body)}>
        <div className="whitespace-pre-wrap break-all font-mono text-xs text-foreground/80">
          {log.body}
        </div>
      </Section>

      <KVSection
        title="Attributes"
        data={log.attributes}
        onFilter={(key, value) => filterBy(`attributes.${key}`, value)}
      />

      <KVSection
        title="Resource"
        data={log.resource}
        onFilter={(key, value) => filterBy(`resource.${key}`, value)}
      />
    </DetailSidebar>
  );
}
