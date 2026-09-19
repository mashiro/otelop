import { TraceAddFilter, TraceFilterBar } from "./trace-filter-bar";
import { useSignalQuery, useTimeWindow, useTraceSelection } from "@/hooks/use-signal-route";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { traceCountAtom, tracesAtom, renderWindowMaxAtom } from "@/stores/telemetry";
import { createFilteredTracesAtom } from "@/stores/filters";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  EventListToolbar,
  EVENT_LIST_TOOLBAR_CLASSNAME,
} from "@/components/filters/event-list-toolbar";
import { ListPanel } from "@/components/common/list-panel";
import { EmptyMatches } from "@/components/common/empty-state";
import { LoadMoreRow } from "@/components/common/load-more-row";
import { BackToLatestRow } from "@/components/common/back-to-latest-row";
import { useTraceListPage } from "@/hooks/use-trace-list-page";
import { SIGNAL_PAGE_SIZE } from "@/hooks/use-signal-list-page";
import { useRenderWindow } from "@/hooks/use-render-window";
import { useLoadOlderRows } from "@/hooks/use-load-older-rows";
import { useTraceById, type TraceByIdStatus } from "@/hooks/use-trace-by-id";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, formatTimestamp, shortId } from "@/lib/format";
import { TraceDetail } from "./trace-detail";
import { EmptyState } from "@/components/common/empty-state";
import { Pill } from "@/components/common/pill";
import { SIGNALS } from "@/lib/signals";
import { traceStatusTone } from "@/lib/tones";
import type { TraceData } from "@/types/telemetry";

export function TraceList() {
  const allTraces = useAtomValue(tracesAtom);
  const traceCount = useAtomValue(traceCountAtom);
  const { state, search, setText } = useSignalQuery("traces");
  const traces = useAtomValue(useMemo(() => createFilteredTracesAtom(search), [search]));
  const {
    traceId: selectedTraceId,
    trace: selectedTrace,
    selectTrace: setSelectedTrace,
  } = useTraceSelection();
  const [window] = useTimeWindow();
  const page = useTraceListPage(window, search);
  const traceById = useTraceById(selectedTraceId, selectedTrace);
  const renderWindowMax = useAtomValue(renderWindowMaxAtom);
  const renderWindow = useRenderWindow({
    items: traces,
    getId: (trace) => trace.traceId,
    max: renderWindowMax,
    pageSize: SIGNAL_PAGE_SIZE,
    resetKey: page.requestKey,
  });
  const { loadMore: handleLoadMore, canLoadMore } = useLoadOlderRows({
    renderWindow,
    page,
    items: traces,
  });

  if (selectedTrace) {
    return <TraceDetail />;
  }

  if (selectedTraceId) {
    return (
      <TraceLoadState
        status={traceById.status}
        onRetry={traceById.retry}
        onBack={() => setSelectedTrace(null)}
      />
    );
  }

  if (traceCount === 0 && allTraces.length === 0 && !search) {
    return <EmptyState signal={SIGNALS.traces} />;
  }

  return (
    <ListPanel
      toolbarClassName={EVENT_LIST_TOOLBAR_CLASSNAME}
      toolbarSecondary={state.filters.length > 0 ? <TraceFilterBar /> : null}
      toolbar={
        <EventListToolbar
          searchValue={state.text}
          onSearchSubmit={setText}
          searchPlaceholder="Search traces…"
          addFilter={<TraceAddFilter />}
          tone="trace"
        />
      }
    >
      {traces.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <EmptyMatches label="traces" />
          <LoadMoreRow
            visible={canLoadMore}
            loadingMore={page.loadingMore}
            onClick={handleLoadMore}
          />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <BackToLatestRow
            count={renderWindow.newerCount}
            label="newer — back to latest"
            onClick={renderWindow.backToLatest}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead tone="trace">Service</TableHead>
                <TableHead tone="trace">Name</TableHead>
                <TableHead tone="trace">Trace ID</TableHead>
                <TableHead className="text-right" tone="trace">
                  Spans
                </TableHead>
                <TableHead className="text-right" tone="trace">
                  Duration
                </TableHead>
                <TableHead className="w-27.5" tone="trace">
                  Started
                </TableHead>
                <TableHead tone="trace">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {renderWindow.visible.map((trace) => (
                <TraceRow key={trace.traceId} trace={trace} onSelect={setSelectedTrace} />
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
    </ListPanel>
  );
}

interface TraceRowProps {
  trace: TraceData;
  onSelect: (trace: TraceData) => void;
}

// Row bail-out is provided by React Compiler.
function TraceRow({ trace, onSelect }: TraceRowProps) {
  const status = trace.rootSpan?.statusCode ?? "Unset";
  return (
    <TableRow tone="trace" interactive stagger onClick={() => onSelect(trace)}>
      <TableCell emphasis="strong">{trace.serviceName || "-"}</TableCell>
      <TableCell emphasis="secondary">
        {trace.rootSpan?.name ?? trace.spans[0]?.name ?? "-"}
      </TableCell>
      <TableCell variant="mono" emphasis="muted">
        {shortId(trace.traceId)}
      </TableCell>
      <TableCell variant="mono" align="right">
        {trace.spanCount}
      </TableCell>
      <TableCell variant="mono" tone="trace" align="right">
        {formatDuration(trace.duration)}
      </TableCell>
      <TableCell variant="mono" emphasis="muted">
        {formatTimestamp(trace.startTime)}
      </TableCell>
      <TableCell>
        <Pill tone={traceStatusTone(status)} dot>
          {status === "Unset" ? "Unset" : status}
        </Pill>
      </TableCell>
    </TableRow>
  );
}

function TraceLoadState({
  status,
  onRetry,
  onBack,
}: {
  status: TraceByIdStatus;
  onRetry: () => void;
  onBack: () => void;
}) {
  const unavailable = status === "not-found";
  return (
    <div className="glass-card flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium text-foreground/70">
          {status === "loading"
            ? "Loading trace…"
            : unavailable
              ? "Trace is no longer retained"
              : "Unable to load trace"}
        </p>
        {status !== "loading" && (
          <div className="flex gap-2">
            {!unavailable && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Retry
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onBack}>
              Back to traces
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
