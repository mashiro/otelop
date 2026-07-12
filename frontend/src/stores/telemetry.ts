import { atom } from "jotai";
import type { Atom, PrimitiveAtom, WritableAtom } from "jotai";
import { Temporal } from "temporal-polyfill";
import type {
  TraceData,
  TraceRootSpan,
  MetricData,
  LogData,
  SpanData,
  DataPoint,
} from "@/types/telemetry";
import {
  activeTabAtom,
  metricKeyEquals,
  selectedLogIdAtom,
  selectedMetricKeyAtom,
  selectedTraceIdAtom,
} from "./navigation";
import { DEFAULT_EVENT_TIME_WINDOW, type EventTimeWindow } from "@/lib/event-time-window";

// Client-side live-buffer bounds. These are NOT derived from the server: the
// DuckDB backend (docs/design/duckdb-storage.md) has no per-signal caps —
// retention is time-based. These constants exist purely to bound the
// in-memory buffer this tab holds so a long-running session doesn't grow
// without limit; historical data beyond them stays queryable from the server
// (see hooks/use-metric-range-points.ts).
export interface BufferCaps {
  traceCap: number;
  metricCap: number;
  logCap: number;
  maxDataPoints: number;
}

const DEFAULT_CONFIG: BufferCaps = {
  traceCap: 1000,
  metricCap: 3000,
  logCap: 5000,
  maxDataPoints: 1000,
};

export const bufferCapsAtom = atom<BufferCaps>(DEFAULT_CONFIG);

// WebSocket connection status
export type WsStatus = "connecting" | "connected" | "disconnected";
export const wsStatusAtom = atom<WsStatus>("disconnected");

// Signal data
export const tracesAtom = atom<TraceData[]>([]);
export const metricsAtom = atom<MetricData[]>([]);
export const logsAtom = atom<LogData[]>([]);
// The window represented by the current server-backed list. It advances only
// when a replacement request succeeds, so selecting another window does not
// hide the previous result while its request is still in flight.
export const traceListWindowAtom = atom<EventTimeWindow>(DEFAULT_EVENT_TIME_WINDOW);
export const logListWindowAtom = atom<EventTimeWindow>(DEFAULT_EVENT_TIME_WINDOW);

// mergeSpans unions two span lists by their stable spanId, keeping the first
// occurrence. WebSocket trace deliveries are summary-only; full spans enter
// through the lazy trace-detail/service-map GraphQL fetches.
export function mergeSpans(existing: SpanData[], incoming: SpanData[]): SpanData[] {
  const seen = new Set(existing.map((s) => s.spanId));
  const deduped = incoming.filter((s) => !seen.has(s.spanId));
  return [...existing, ...deduped];
}

// Each WS batch's searchValues (see internal/broadcast/broadcast.go's
// traceSearchValues) covers only the spans delivered in that one batch, while
// mergeSpans above unions the spans themselves — so a later batch's
// searchValues must be unioned with, not replace, values already learned from
// an earlier delivery, or a value only present in an earlier batch stops
// matching the search.
function mergeSearchValues(
  existing: string[] | undefined,
  incoming: string[] | undefined,
): string[] | undefined {
  if (!existing || existing.length === 0) return incoming;
  if (!incoming || incoming.length === 0) return existing;
  return [...new Set([...existing, ...incoming])];
}

function newestTraceStartFirst(traces: TraceData[]): TraceData[] {
  return traces.toSorted((a, b) =>
    Temporal.Instant.compare(
      Temporal.Instant.from(b.startTime),
      Temporal.Instant.from(a.startTime),
    ),
  );
}

// Write-only: add single item from WebSocket
export const addTraceAtom = atom(null, (get, set, newTrace: TraceData) => {
  const current = get(tracesAtom);
  const maxTraces = get(bufferCapsAtom).traceCap;
  const idx = current.findIndex((t) => t.traceId === newTrace.traceId);
  if (idx >= 0) {
    const existing = current[idx];
    const mergedSpans = mergeSpans(existing.spans, newTrace.spans);
    const rootChanged = isBetterRoot(existing.rootSpan, newTrace.rootSpan);
    // OTel timestamps are nanosecond-precision ISO strings; compare via
    // Temporal.Instant to avoid Date's millisecond truncation.
    const newStart = Temporal.Instant.from(newTrace.startTime).epochNanoseconds;
    const existingStart = Temporal.Instant.from(existing.startTime).epochNanoseconds;
    if (
      mergedSpans.length === existing.spans.length &&
      !rootChanged &&
      newTrace.spanCount <= existing.spanCount &&
      newTrace.duration <= existing.duration &&
      newStart >= existingStart
    ) {
      return;
    }
    const updated = [...current];
    updated[idx] = {
      ...existing,
      spans: mergedSpans,
      searchValues: mergeSearchValues(existing.searchValues, newTrace.searchValues),
      // WebSocket payloads carry an authoritative persisted summary with an
      // empty spans array. Preserve already-fetched detail while letting a
      // growing summary trigger useTraceSpans to fetch the missing rows.
      spanCount: Math.max(existing.spanCount, newTrace.spanCount),
      rootSpan: rootChanged ? newTrace.rootSpan : existing.rootSpan,
      serviceName: rootChanged ? newTrace.serviceName : existing.serviceName,
      // Multi-root Codex traces can grow past the originally-reported root
      // span duration. Always take the larger range so the list/detail
      // header reflect the full trace length.
      startTime: newStart < existingStart ? newTrace.startTime : existing.startTime,
      duration: Math.max(existing.duration, newTrace.duration),
    };
    set(tracesAtom, newestTraceStartFirst(updated));
  } else {
    // A brand-new trace, never merged into an existing one — the header
    // badge's "genuinely new" signal (see totalTraceCountAtom).
    set(newTraceCountAtom, (n) => n + 1);
    const next = newestTraceStartFirst([...current, newTrace]);
    set(tracesAtom, next.length > maxTraces ? next.slice(0, maxTraces) : next);
  }
});

interface TraceSpansPayload {
  traceId: string;
  spans: SpanData[];
}

// Write-only: merge freshly GraphQL-fetched full span data for potentially
// many traces at once into the buffer, in a single tracesAtom update rather
// than one per trace — used by the service map's bulk fetch
// (hooks/use-service-map-spans.ts), which can touch every buffered trace in
// one go. List-loaded trace summaries start with spans: [] (see
// hooks/use-initial-load.ts) since fetching every buffered trace's spans up
// front is the N+1 this whole lazy-loading scheme exists to avoid.
// Deliberately leaves spanCount/duration/rootSpan/serviceName untouched —
// those already came from the TracesPage summary and are authoritative,
// unlike spans.length which this fetch may only be partially racing a live
// WS delivery for.
export const mergeManyTraceSpansAtom = atom(null, (get, set, payloads: TraceSpansPayload[]) => {
  const byTraceID = new Map(payloads.map((p) => [p.traceId, p.spans]));
  if (byTraceID.size === 0) return;
  const current = get(tracesAtom);
  let changed = false;
  const updated = current.map((t) => {
    const incoming = byTraceID.get(t.traceId);
    if (!incoming) return t;
    const mergedSpans = mergeSpans(t.spans, incoming);
    if (mergedSpans.length === t.spans.length) return t;
    changed = true;
    return { ...t, spans: mergedSpans };
  });
  if (changed) set(tracesAtom, updated);
});

// Write-only: merge freshly GraphQL-fetched full span data into one trace
// already in the buffer — the single-trace case of mergeManyTraceSpansAtom
// above, used by the trace-detail lazy fetch (hooks/use-trace-spans.ts).
export const mergeTraceSpansAtom = atom(null, (_get, set, payload: TraceSpansPayload) => {
  set(mergeManyTraceSpansAtom, [payload]);
});

// Picks the longest parentless span as the representative root for display.
function isBetterRoot(
  current: TraceRootSpan | undefined,
  candidate: TraceRootSpan | undefined,
): boolean {
  if (!candidate) return false;
  if (!current) return true;
  return candidate.duration > current.duration;
}

// mergeDataPoints unions two data-point lists by their stable id, keeping the
// first occurrence. A metric update from the WebSocket carries the metric's
// full accumulated points, which overlap the ones already loaded; merging by id
// makes the update idempotent so re-delivered points aren't duplicated.
// Exported so hooks/use-metric-range-points.ts can union a server-fetched
// range snapshot with the live buffer using the same de-dup rule.
export function mergeDataPoints(existing: DataPoint[], incoming: DataPoint[]): DataPoint[] {
  const seen = new Set<string>();
  const merged: DataPoint[] = [];
  for (const dp of existing) {
    if (seen.has(dp.id)) continue;
    seen.add(dp.id);
    merged.push(dp);
  }
  for (const dp of incoming) {
    if (seen.has(dp.id)) continue;
    seen.add(dp.id);
    merged.push(dp);
  }
  return merged;
}

// addMetricAtom merges a WS delivery's dataPoints into the matching
// (serviceName, name) group, or creates a new group entry. pointCount/
// latestValue (the metrics list's summary columns — see MetricData's doc
// comment) are never read off the wire payload, which never carries them
// (internal/broadcast/wire.go's MetricData has no such fields, only
// dataPoints) — they're derived here from the merge itself: pointCount
// widens by exactly the genuinely-new-point delta (a re-delivered point
// mergeDataPoints already dedupes must not double count), and latestValue
// only moves when that delta is nonzero, to the newest point's value.
export const addMetricAtom = atom(null, (get, set, newMetric: MetricData) => {
  const current = get(metricsAtom);
  const maxMetrics = get(bufferCapsAtom).metricCap;
  const idx = current.findIndex((m) => metricKeyEquals(m, newMetric));
  if (idx >= 0) {
    const existing = current[idx];
    const merged = mergeDataPoints(existing.dataPoints, newMetric.dataPoints);
    const addedCount = merged.length - existing.dataPoints.length;
    const updated = [...current];
    updated[idx] = {
      ...existing,
      dataPoints: merged.slice(-get(bufferCapsAtom).maxDataPoints),
      pointCount: existing.pointCount + addedCount,
      latestValue: addedCount > 0 ? merged[merged.length - 1].value : existing.latestValue,
      receivedAt: newMetric.receivedAt,
    };
    set(metricsAtom, updated);
  } else {
    // A brand-new (serviceName, name) group — the header badge's
    // "genuinely new" signal (see totalMetricCountAtom); config.metricCount
    // counts groups the same way (storage.Counts), so this mirrors it.
    set(newMetricCountAtom, (n) => n + 1);
    const next = [
      {
        ...newMetric,
        pointCount: newMetric.dataPoints.length,
        latestValue: newMetric.dataPoints.at(-1)?.value ?? null,
      },
      ...current,
    ];
    set(metricsAtom, next.length > maxMetrics ? next.slice(0, maxMetrics) : next);
  }
});

export const addLogAtom = atom(null, (get, set, newLog: LogData) => {
  const maxLogs = get(bufferCapsAtom).logCap;
  // Every log is a genuinely new row — there's no merge-into-existing
  // concept for logs (unlike traces/metrics), so this always increments.
  set(newLogCountAtom, (n) => n + 1);
  set(logsAtom, (prev) => {
    const next = [newLog, ...prev];
    return next.length > maxLogs ? next.slice(0, maxLogs) : next;
  });
});

// Server-reported totals as of the initial load (config.traceCount/
// metricCount/logCount — see hooks/use-initial-load.ts), seeded once via
// setTotalCountsAtom and never re-fetched afterward.
export const totalTraceCountAtom = atom(0);
export const totalMetricCountAtom = atom(0);
export const totalLogCountAtom = atom(0);

// Genuinely new items observed since the initial load: incremented only by
// addTraceAtom's/addMetricAtom's create branch (never their merge branch) and
// always by addLogAtom. A "Load more" page (appendTracesAtom/appendLogsAtom)
// or a lazy detail fetch re-fetches rows the total above already counted, so
// neither of those — nor setTracesAtom/setMetricsAtom/setLogsAtom's initial
// page-1 replace — touches these.
export const newTraceCountAtom = atom(0);
export const newMetricCountAtom = atom(0);
export const newLogCountAtom = atom(0);

export interface SignalTotals {
  traceCount: number;
  metricCount: number;
  logCount: number;
}

// Write-only: seeds the server-reported totals once at initial load (see
// hooks/use-initial-load.ts).
export const setTotalCountsAtom = atom(null, (_get, set, totals: SignalTotals) => {
  set(totalTraceCountAtom, totals.traceCount);
  set(totalMetricCountAtom, totals.metricCount);
  set(totalLogCountAtom, totals.logCount);
});

// Header badge totals: server-reported total (as of load) plus every
// genuinely new item observed since. A server-side retention sweep can
// shrink the true total after load; since the total is never re-fetched,
// that drift is accepted rather than reconciled — a live tab badge running
// slightly high until the next full reload re-seeds it is preferable to
// re-querying config on every tick just to catch a rare sweep.
export const traceCountAtom = atom((get) => get(totalTraceCountAtom) + get(newTraceCountAtom));
export const metricCountAtom = atom((get) => get(totalMetricCountAtom) + get(newMetricCountAtom));
export const logCountAtom = atom((get) => get(totalLogCountAtom) + get(newLogCountAtom));

// Selection state. The id/key (not the object) is the source of truth so it
// can be restored from the URL before the matching data has loaded — the
// derived read resolves once tracesAtom/metricsAtom catch up. Equality
// guarding and URL sync live on the key atom itself (navigation.ts).
function createSelectionAtom<Item, Key>(
  keyAtom: WritableAtom<Key | null, [Key | null], void>,
  listAtom: Atom<Item[]>,
  toKey: (item: Item) => Key,
  matches: (item: Item, key: Key) => boolean,
) {
  return atom(
    (get) => {
      const key = get(keyAtom);
      if (key === null) return null;
      return get(listAtom).find((item) => matches(item, key)) ?? null;
    },
    (_get, set, item: Item | null) => {
      set(keyAtom, item ? toKey(item) : null);
    },
  );
}

export const selectedTraceAtom = createSelectionAtom(
  selectedTraceIdAtom,
  tracesAtom,
  (t) => t.traceId,
  (t, id) => t.traceId === id,
);

export const selectedMetricAtom = createSelectionAtom(
  selectedMetricKeyAtom,
  metricsAtom,
  (m) => ({ serviceName: m.serviceName, name: m.name }),
  metricKeyEquals,
);

export const selectedLogAtom = createSelectionAtom(
  selectedLogIdAtom,
  logsAtom,
  (l) => l.id,
  (l, id) => l.id === id,
);

// Log filter by traceId (set when jumping from trace → logs)
export const logTraceFilterAtom = atom<string | null>(null);

// Navigate: log → trace (find trace by ID and switch tab)
export const navigateToTraceAtom = atom(null, (get, set, traceId: string) => {
  const traces = get(tracesAtom);
  const trace = traces.find((t) => t.traceId === traceId);
  if (trace) {
    set(selectedTraceAtom, trace);
    set(activeTabAtom, "traces");
  }
});

// Navigate: trace → related logs (switch to logs tab with filter)
export const navigateToLogsAtom = atom(null, (_get, set, traceId: string) => {
  set(logTraceFilterAtom, traceId);
  set(activeTabAtom, "logs");
});

// The ids the server returned for the traces/logs tab's CURRENT paginated
// fetch session — every id from the replacement page plus each "Load more"
// page (issue #161). Replacing the page starts a fresh session, so ids matched under a
// previous search never linger); appendTracesAtom/appendLogsAtom union into
// it. filters.ts's search display-filter treats membership as "the server
// already vouched this row matches the active search" and only applies its
// client-side predicate to rows OUTSIDE the set (live WS prepends) — a
// server-paginated trace summary carries spans: [], so it cannot re-prove a
// non-root span-name/status match client-side.
export const serverMatchedTraceIdsAtom = atom<ReadonlySet<string>>(new Set<string>());
export const serverMatchedLogIdsAtom = atom<ReadonlySet<string>>(new Set<string>());

// The (serviceName, name) keys (see navigation.ts's metricKeyToString) the
// server returned for the currently active metrics search
// (hooks/use-metric-list-search.ts). Unlike traces/logs, metrics has no
// pagination to replace — metricsAtom is always the complete buffer (initial
// load + WS merges) — but the search result still must not itself overwrite
// that buffer (a zero-hit search would wipe every metric ever seen). This set
// is filters.ts's filteredMetricsAtom's server-vouched membership instead.
export const serverMatchedMetricKeysAtom = atom<ReadonlySet<string>>(new Set<string>());

export const setMetricsAtom = atom(null, (_get, set, metrics: MetricData[]) => {
  set(metricsAtom, metrics);
});

// createListSessionAtoms builds the write atoms for a server-paginated
// list session (traces/logs), mirroring createSelectionAtom's factory idiom.
// Every page write updates its companion serverMatched*IdsAtom in the same
// transaction so list contents and server-vouched IDs cannot drift apart.
interface ReplacementPage<T> {
  items: T[];
  idsBeforeRequest: ReadonlySet<string>;
  window: EventTimeWindow;
}

function createPaginatedListAtoms<T>(
  listAtom: PrimitiveAtom<T[]>,
  matchedIdsAtom: PrimitiveAtom<ReadonlySet<string>>,
  listWindowAtom: PrimitiveAtom<EventTimeWindow>,
  getId: (item: T) => string,
  getCap: (caps: BufferCaps) => number,
  orderItems: (items: T[]) => T[] = (items) => items,
) {
  const set = atom(null, (_get, set, items: T[]) => {
    set(listAtom, orderItems(items));
    set(matchedIdsAtom, new Set(items.map(getId)));
  });

  // A new request session replaces the server-backed rows while preserving rows delivered
  // live after its request started. A live row also wins an ID collision
  // because it may carry richer data than the paginated summary.
  const replacePage = atom(
    null,
    (get, set, { items, idsBeforeRequest, window }: ReplacementPage<T>) => {
      const liveItems = get(listAtom).filter((item) => !idsBeforeRequest.has(getId(item)));
      const liveIds = new Set(liveItems.map(getId));
      const merged = [...liveItems, ...items.filter((item) => !liveIds.has(getId(item)))];
      const cap = getCap(get(bufferCapsAtom));
      const ordered = orderItems(merged);
      set(listAtom, ordered.length > cap ? ordered.slice(0, cap) : ordered);
      set(matchedIdsAtom, new Set(items.map(getId)));
      set(listWindowAtom, window);
    },
  );

  // Write-only: append an older page fetched via "Load more" to the tail of
  // the buffer, deduping against whatever's already there — an item can
  // appear in both a freshly-paged response and the live WS buffer (e.g. a
  // page boundary race), and de-dup by id keeps the existing (possibly
  // WS-merged) entry rather than overwriting it with the paged summary.
  const append = atom(null, (get, set, olderItems: T[]) => {
    // Every returned id joins the server-matched set — including ones
    // deduped out of the buffer below: a WS-delivered item the server ALSO
    // returned for the active search is server-vouched even though the
    // buffer keeps the WS entry.
    set(matchedIdsAtom, (prev) => new Set([...prev, ...olderItems.map(getId)]));
    const current = get(listAtom);
    const seen = new Set(current.map(getId));
    const deduped = olderItems.filter((item) => !seen.has(getId(item)));
    if (deduped.length === 0) return;
    const merged = orderItems([...current, ...deduped]);
    const cap = getCap(get(bufferCapsAtom));
    // Paging in more history than the live-buffer cap allows evicts the same
    // way a WS burst would (oldest-first slice, appended rows are at the
    // tail) — an accepted trade-off (see issue #160): the cap bounds this
    // tab's memory, it doesn't guarantee every manually paged-in row stays
    // resident.
    set(listAtom, merged.length > cap ? merged.slice(0, cap) : merged);
  });

  return { set, replacePage, append };
}

const traceList = createPaginatedListAtoms(
  tracesAtom,
  serverMatchedTraceIdsAtom,
  traceListWindowAtom,
  (t: TraceData) => t.traceId,
  (caps) => caps.traceCap,
  newestTraceStartFirst,
);
export const setTracesAtom = traceList.set;
export const replaceTracePageAtom = traceList.replacePage;
export const appendTracesAtom = traceList.append;

const logList = createPaginatedListAtoms(
  logsAtom,
  serverMatchedLogIdsAtom,
  logListWindowAtom,
  (l: LogData) => l.id,
  (caps) => caps.logCap,
);
export const setLogsAtom = logList.set;
export const replaceLogPageAtom = logList.replacePage;
export const appendLogsAtom = logList.append;
