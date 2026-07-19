import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { traceCountAtom, tracesAtom, selectedTraceAtom } from "@/stores/telemetry";
import { eventTimeWindowAtom, selectedTraceIdAtom } from "@/stores/navigation";
import { filteredTracesAtom, traceSearchAtom } from "@/stores/filters";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchFilter } from "@/components/filters/search-filter";
import { ListPanel } from "@/components/common/list-panel";
import { EmptyMatches } from "@/components/common/empty-state";
import { EventWindowControls } from "@/components/common/event-window-controls";
import { LoadMoreRow } from "@/components/common/load-more-row";
import { ListOverflowNotice } from "@/components/common/list-overflow-notice";
import { useTraceListPage } from "@/hooks/use-trace-list-page";
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
import { LIST_DISPLAY_CAP } from "@/lib/list-render-cap";

export function TraceList() {
  const allTraces = useAtomValue(tracesAtom);
  const traceCount = useAtomValue(traceCountAtom);
  const traces = useAtomValue(filteredTracesAtom);
  const selectedTraceId = useAtomValue(selectedTraceIdAtom);
  const selectedTrace = useAtomValue(selectedTraceAtom);
  const setSelectedTrace = useSetAtom(selectedTraceAtom);
  const [window] = useAtom(eventTimeWindowAtom);
  const search = useAtomValue(traceSearchAtom);
  const page = useTraceListPage(window, search);
  const traceById = useTraceById(selectedTraceId, selectedTrace);
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

  if (traceCount === 0 && allTraces.length === 0) {
    return <EmptyState signal={SIGNALS.traces} />;
  }

  const visibleTraces = traces.slice(0, LIST_DISPLAY_CAP);
  const hiddenTraceCount = traces.length - visibleTraces.length;

  return (
    <ListPanel
      toolbar={
        <>
          <SearchFilter atom={traceSearchAtom} placeholder="Search traces…" />
          <div className="ml-auto">
            <EventWindowControls tone="trace" allRetained={Boolean(search.trim())} />
          </div>
        </>
      }
    >
      {traces.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <EmptyMatches label="traces" />
          <LoadMoreRow {...page} />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/50 bg-muted hover:bg-muted">
                <TableHead className="text-trace/70">Service</TableHead>
                <TableHead className="text-trace/70">Name</TableHead>
                <TableHead className="text-trace/70">Trace ID</TableHead>
                <TableHead className="text-right text-trace/70">Spans</TableHead>
                <TableHead className="text-right text-trace/70">Duration</TableHead>
                <TableHead className="w-[110px] text-trace/70">Started</TableHead>
                <TableHead className="text-trace/70">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleTraces.map((trace, idx) => (
                <TraceRow
                  key={trace.traceId}
                  trace={trace}
                  index={idx}
                  onSelect={setSelectedTrace}
                />
              ))}
            </TableBody>
          </Table>
          <ListOverflowNotice hiddenCount={hiddenTraceCount} />
          <LoadMoreRow {...page} />
        </ScrollArea>
      )}
    </ListPanel>
  );
}

interface TraceRowProps {
  trace: TraceData;
  index: number;
  onSelect: (trace: TraceData) => void;
}

// Row bail-out is provided by React Compiler.
function TraceRow({ trace, index, onSelect }: TraceRowProps) {
  const status = trace.rootSpan?.statusCode ?? "Unset";
  return (
    <TableRow
      className="stagger-row cursor-pointer border-b border-border/30 transition-colors hover:bg-trace/5"
      style={{ animationDelay: `${Math.min(index * 20, 200)}ms` }}
      onClick={() => onSelect(trace)}
    >
      <TableCell className="font-medium">{trace.serviceName || "-"}</TableCell>
      <TableCell className="text-foreground/80">
        {trace.rootSpan?.name ?? trace.spans[0]?.name ?? "-"}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {shortId(trace.traceId)}
      </TableCell>
      <TableCell className="text-right font-mono text-xs">{trace.spanCount}</TableCell>
      <TableCell className="text-right font-mono text-xs text-trace">
        {formatDuration(trace.duration)}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
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
