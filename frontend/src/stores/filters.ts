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
  loadedOlderLogIdsAtom,
  metricSearchResultAtom,
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
  const logs = get(logsAtom);
  const loadedOlderIds = get(loadedOlderLogIdsAtom);
  if (window.mode === "live") {
    if (window.range === "all") return logs;
    const inRangeIds = new Set(filterDataPointsInRange(logs, window.range).map((log) => log.id));
    return logs.filter((log) => loadedOlderIds.has(log.id) || inRangeIds.has(log.id));
  }
  const { from, to } = eventWindowBounds(window);
  return get(logsAtom).filter(
    (log) => loadedOlderIds.has(log.id) || inEventWindow(log.timestamp, from, to),
  );
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

export const filteredMetricsAtom = atom<MetricData[]>((get) => {
  const buffered = get(metricsAtom);
  const search = get(metricSearchAtom);
  if (!search) return buffered;

  const q = search.toLowerCase();
  const result = get(metricSearchResultAtom);
  const serverItems = result.search === search ? result.items : [];
  const bufferedByKey = new Map(buffered.map((metric) => [metricKeyToString(metric), metric]));
  const included = new Set<string>();
  const matches = serverItems.map((metric) => {
    const key = metricKeyToString(metric);
    included.add(key);
    // A buffered row may contain newer WS-derived summary fields and loaded
    // detail points; the server row is only needed when the bounded buffer no
    // longer contains this retained metric.
    return bufferedByKey.get(key) ?? metric;
  });

  for (const metric of buffered) {
    const key = metricKeyToString(metric);
    if (included.has(key)) continue;
    const fields = [metric.name, metric.serviceName ?? "", metric.type, metric.description ?? ""];
    if (fields.some((field) => field.toLowerCase().includes(q))) matches.push(metric);
  }
  return matches;
});
