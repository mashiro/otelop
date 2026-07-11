import { useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { List, Network } from "lucide-react";
import { tracesAtom, selectedTraceAtom } from "@/stores/telemetry";
import { selectedTraceRangeAtom } from "@/stores/navigation";
import { filteredTracesAtom, traceSearchAtom } from "@/stores/filters";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchFilter } from "@/components/filters/search-filter";
import { ListPanel } from "@/components/common/list-panel";
import { EmptyMatches } from "@/components/common/empty-state";
import { useServiceMapSpans } from "@/hooks/use-service-map-spans";
import { useTraceListPage } from "@/hooks/use-trace-list-page";
import { ServiceMap } from "./service-map";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHART_TIME_RANGES, type ChartTimeRange } from "@/lib/chart-time-range";
import { formatDuration, formatRelativeTime, shortId } from "@/lib/format";
import { TraceDetail } from "./trace-detail";
import { EmptyState } from "@/components/common/empty-state";
import { Pill } from "@/components/common/pill";
import { SIGNALS } from "@/lib/signals";
import { traceStatusTone } from "@/lib/tones";

export function TraceList() {
  const allTraces = useAtomValue(tracesAtom);
  const traces = useAtomValue(filteredTracesAtom);
  const selectedTrace = useAtomValue(selectedTraceAtom);
  const setSelectedTrace = useSetAtom(selectedTraceAtom);
  const [view, setView] = useState<"list" | "map">("list");
  const [range, setRange] = useAtom(selectedTraceRangeAtom);
  const search = useAtomValue(traceSearchAtom);
  const { total, loaded, hasMore, loadingMore, loadMore } = useTraceListPage(range, search);
  // The service map needs full span data across every buffered trace (see
  // lib/service-graph.ts), which the trace list itself deliberately doesn't
  // load (use-trace-list-page.ts). Fetch it lazily, once per range, the
  // first time this view is actually opened.
  useServiceMapSpans(view === "map", range);

  if (selectedTrace) {
    return <TraceDetail />;
  }

  if (allTraces.length === 0) {
    return <EmptyState signal={SIGNALS.traces} />;
  }

  return (
    <ListPanel
      toolbar={
        <>
          <SearchFilter atom={traceSearchAtom} placeholder="Search traces…" />
          <div className="ml-auto flex items-center gap-2 px-3">
            <Tabs value={range} onValueChange={(v) => setRange(v as ChartTimeRange)}>
              <TabsList className="h-7 bg-muted/50">
                {CHART_TIME_RANGES.map((r) => (
                  <TabsTrigger
                    key={r.value}
                    value={r.value}
                    className="h-6 px-2 text-xs data-active:bg-trace/15 data-active:text-trace"
                  >
                    {r.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setView("list")}
                className={`rounded p-1 transition-colors ${view === "list" ? "bg-trace/15 text-trace" : "text-muted-foreground hover:text-foreground"}`}
                title="List view"
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setView("map")}
                className={`rounded p-1 transition-colors ${view === "map" ? "bg-trace/15 text-trace" : "text-muted-foreground hover:text-foreground"}`}
                title="Service map"
              >
                <Network className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      }
    >
      {view === "map" ? (
        <div className="min-h-0 flex-1">
          <ServiceMap />
        </div>
      ) : traces.length === 0 ? (
        <EmptyMatches label="traces" />
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
                <TableHead className="text-trace/70">Started</TableHead>
                <TableHead className="text-trace/70">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traces.map((trace, idx) => {
                const status = trace.rootSpan?.statusCode ?? "Unset";
                return (
                  <TableRow
                    key={trace.traceId}
                    className="stagger-row cursor-pointer border-b border-border/30 transition-colors hover:bg-trace/5"
                    style={{ animationDelay: `${Math.min(idx * 20, 200)}ms` }}
                    onClick={() => setSelectedTrace(trace)}
                  >
                    <TableCell className="font-medium">{trace.serviceName || "-"}</TableCell>
                    <TableCell className="text-foreground/80">
                      {trace.rootSpan?.name ?? trace.spans[0]?.name ?? "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {shortId(trace.traceId)}
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
                      <Pill tone={traceStatusTone(status)} dot>
                        {status === "Unset" ? "Unset" : status}
                      </Pill>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {hasMore && (
            <div className="border-t border-border/30 p-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore
                  ? "Loading…"
                  : `Load more (${loaded.toLocaleString()} of ${total.toLocaleString()})`}
              </Button>
            </div>
          )}
        </ScrollArea>
      )}
    </ListPanel>
  );
}
