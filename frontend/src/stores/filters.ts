import { atom } from "jotai";
import type { Atom, PrimitiveAtom } from "jotai";
import { filterDataPointsInRange } from "@/lib/chart-time-range";
import { selectedLogRangeAtom, selectedTraceRangeAtom } from "./navigation";
import {
  tracesAtom,
  metricsAtom,
  logsAtom,
  logTraceFilterAtom,
  serverMatchedTraceIdsAtom,
  serverMatchedLogIdsAtom,
} from "./telemetry";
import type { TraceData, MetricData, LogData } from "@/types/telemetry";

function createSearchAtom<T>(
  sourceAtom: Atom<T[]>,
  searchAtom: PrimitiveAtom<string>,
  extractFields: (item: T) => string[],
) {
  return atom<T[]>((get) => {
    const items = get(sourceAtom);
    const search = get(searchAtom);
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((item) => extractFields(item).some((f) => f.toLowerCase().includes(q)));
  });
}

// createServerBackedSearchAtom is createSearchAtom for a list whose search is
// primarily answered SERVER-side (issue #161's traces/logs lists): any row
// whose id is in serverIdsAtom was returned by the server FOR the currently
// active search, so it passes unconditionally — the server matched fields the
// client can't re-check (a paginated trace summary carries spans: [], so a
// non-root span-name/status match is invisible here). The client-side
// predicate applies only to rows outside that set, i.e. live WebSocket
// prepends (stores/telemetry.ts's addTraceAtom/addLogAtom write to the
// buffer with no awareness of the active search), keeping a non-matching
// live arrival from flashing into a filtered list.
function createServerBackedSearchAtom<T>(
  sourceAtom: Atom<T[]>,
  searchAtom: PrimitiveAtom<string>,
  serverIdsAtom: Atom<ReadonlySet<string>>,
  getId: (item: T) => string,
  extractFields: (item: T) => string[],
) {
  return atom<T[]>((get) => {
    const items = get(sourceAtom);
    const search = get(searchAtom);
    if (!search) return items;
    const q = search.toLowerCase();
    const serverIds = get(serverIdsAtom);
    return items.filter(
      (item) =>
        serverIds.has(getId(item)) || extractFields(item).some((f) => f.toLowerCase().includes(q)),
    );
  });
}

// traceSearchAtom/logSearchAtom drive the server-side search arg
// (hooks/use-trace-list-page.ts, hooks/use-log-list-page.ts); the
// createServerBackedSearchAtom wrappers below only re-apply the predicate to
// live-prepended rows the server never saw.
export const traceSearchAtom = atom("");

// The live-tail display filter (issue #160): tracesAtom already only holds
// what was server-paginated within the selected range plus whatever the
// WebSocket has prepended since — but a session left open past the range's
// length would otherwise keep showing paged-in rows that have aged out of
// "the last <range>". Anchoring on the max loaded startTime (not wall-clock)
// mirrors the metric chart's rolling window (see metric-detail.tsx's
// windowedDataPoints) and keeps re-deriving the true visible window as new
// data arrives.
const rangeFilteredTracesAtom = atom((get) =>
  filterDataPointsInRange(get(tracesAtom), get(selectedTraceRangeAtom), (t) => t.startTime),
);

// The client-side predicate (live WS rows only — see
// createServerBackedSearchAtom) mirrors the server's TracesPage search
// (query_trace.go): trace ID, any span's name/status, service. A
// WS-delivered trace carries its full span set (stores/telemetry.ts's
// addTraceAtom), so per-span name/status are checkable here; the
// summary-level serviceName/rootSpan fields cover rows whose spans haven't
// merged yet. The trace's resolved serviceName stands in for per-span
// service matching — it's the field reliably present on every row shape.
export const filteredTracesAtom = createServerBackedSearchAtom(
  rangeFilteredTracesAtom,
  traceSearchAtom,
  serverMatchedTraceIdsAtom,
  (t: TraceData) => t.traceId,
  (t: TraceData) => [
    t.traceId,
    t.serviceName ?? "",
    t.rootSpan?.name ?? "",
    t.rootSpan?.statusCode ?? "Unset",
    ...t.spans.flatMap((s) => [s.name, s.statusCode]),
  ],
);

export const logSearchAtom = atom("");

// See rangeFilteredTracesAtom above — same live-tail rolling-window rationale.
const rangeFilteredLogsAtom = atom((get) =>
  filterDataPointsInRange(get(logsAtom), get(selectedLogRangeAtom)),
);

// The client-side predicate (live WS rows only) mirrors the server's
// LogsPage search (query_log.go): body, service name, severity text, trace ID.
const filteredLogsBySearchAtom = createServerBackedSearchAtom(
  rangeFilteredLogsAtom,
  logSearchAtom,
  serverMatchedLogIdsAtom,
  (l: LogData) => l.id,
  (l: LogData) => [l.body, l.serviceName ?? "", l.severityText ?? "", l.traceId],
);

export const filteredLogsAtom = atom<LogData[]>((get) => {
  const traceFilter = get(logTraceFilterAtom);
  const logs = get(filteredLogsBySearchAtom);
  if (!traceFilter) return logs;
  return logs.filter((l) => l.traceId === traceFilter);
});

export const metricSearchAtom = atom("");

export const filteredMetricsAtom = createSearchAtom(
  metricsAtom,
  metricSearchAtom,
  (m: MetricData) => [m.name, m.serviceName ?? "", m.type, m.description ?? ""],
);
