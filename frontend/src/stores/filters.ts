import { atom } from "jotai";
import type { Atom, PrimitiveAtom } from "jotai";
import { Temporal } from "temporal-polyfill";
import { filterDataPointsInRange } from "@/lib/chart-time-range";
import { eventWindowBounds } from "@/lib/event-time-window";
import {
  tracesAtom,
  metricsAtom,
  logsAtom,
  logTraceFilterAtom,
  serverMatchedTraceIdsAtom,
  serverMatchedLogIdsAtom,
  serverMatchedMetricKeysAtom,
  traceListWindowAtom,
  logListWindowAtom,
} from "./telemetry";
import { metricKeyToString } from "./navigation";
import type { TraceData, MetricData, LogData } from "@/types/telemetry";

// createServerBackedSearchAtom is a display filter for a list whose search is
// primarily answered SERVER-side (issue #161's traces/logs lists, and
// metrics' zero-hit-search fix below): any row whose id is in serverIdsAtom
// was returned by the server FOR the currently active search, so it passes
// unconditionally — the server matched fields the client can't re-check (a
// paginated trace summary carries spans: [], so a non-root span-name/status
// match is invisible here). The client-side predicate applies only to rows
// outside that set, i.e. live WebSocket prepends (stores/telemetry.ts's
// addTraceAtom/addLogAtom/addMetricAtom write to the buffer with no
// awareness of the active search), keeping a non-matching live arrival from
// flashing into a filtered list.
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
function inEventWindow(timestamp: string, from: string | undefined, to: string): boolean {
  const instant = Temporal.Instant.from(timestamp);
  return (
    (!from || Temporal.Instant.compare(instant, Temporal.Instant.from(from)) >= 0) &&
    Temporal.Instant.compare(instant, Temporal.Instant.from(to)) < 0
  );
}

const rangeFilteredTracesAtom = atom((get) => {
  const window = get(traceListWindowAtom);
  if (window.mode === "live") {
    return filterDataPointsInRange(get(tracesAtom), window.range, (trace) => trace.startTime);
  }
  const { from, to } = eventWindowBounds(window);
  return get(tracesAtom).filter((trace) => inEventWindow(trace.startTime, from, to));
});

// The client-side predicate (live WS rows only — see
// createServerBackedSearchAtom) mirrors the server's TracesPage search
// (query_trace.go): trace ID, any loaded span's name/status, service. Live
// WebSocket rows are summary-only, so root/service fields are immediately
// searchable; non-root span fields become searchable after lazy detail load.
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
    ...(t.searchValues ?? []),
    ...t.spans.flatMap((s) => [s.name, s.statusCode]),
  ],
);

export const logSearchAtom = atom("");

// See rangeFilteredTracesAtom above — same live-tail rolling-window rationale.
const rangeFilteredLogsAtom = atom((get) => {
  const window = get(logListWindowAtom);
  if (window.mode === "live") return filterDataPointsInRange(get(logsAtom), window.range);
  const { from, to } = eventWindowBounds(window);
  return get(logsAtom).filter((log) => inEventWindow(log.timestamp, from, to));
});

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

// Metrics has no pagination to replace (metricsAtom is always the complete
// buffer — see stores/telemetry.ts), so unlike traces/logs there was no
// server-vouched-id concept until this fixed a real bug: the old
// implementation had hooks/use-metric-list-search.ts REPLACE metricsAtom
// itself with the server's search result, so a zero-hit search wiped the
// entire buffer (and, with it, the toolbar rendering this very search box —
// see components/metrics/metric-list.tsx). Routing the search result through
// serverMatchedMetricKeysAtom instead — the same server-backed-search shape
// traces/logs use — keeps metricsAtom untouched by search.
export const filteredMetricsAtom = createServerBackedSearchAtom(
  metricsAtom,
  metricSearchAtom,
  serverMatchedMetricKeysAtom,
  metricKeyToString,
  (m: MetricData) => [m.name, m.serviceName ?? "", m.type, m.description ?? ""],
);
