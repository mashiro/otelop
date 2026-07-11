import { atom } from "jotai";
import type { Atom, WritableAtom } from "jotai";
import { Temporal } from "temporal-polyfill";
import type { TraceData, MetricData, LogData, SpanData, DataPoint } from "@/types/telemetry";
import {
  activeTabAtom,
  metricKeyEquals,
  selectedLogIdAtom,
  selectedMetricKeyAtom,
  selectedTraceIdAtom,
} from "./navigation";

// Client-side live-buffer bounds. These are NOT derived from the server: the
// DuckDB backend (docs/design/duckdb-storage.md) has no per-signal caps —
// retention is time-based. These constants exist purely to bound the
// in-memory buffer this tab holds so a long-running session doesn't grow
// without limit; historical data beyond them stays queryable from the server
// (see hooks/use-metric-range-points.ts).
export interface ServerConfig {
  traceCap: number;
  metricCap: number;
  logCap: number;
  maxDataPoints: number;
}

const DEFAULT_CONFIG: ServerConfig = {
  traceCap: 1000,
  metricCap: 3000,
  logCap: 5000,
  maxDataPoints: 1000,
};

export const serverConfigAtom = atom<ServerConfig>(DEFAULT_CONFIG);

// WebSocket connection status
export type WsStatus = "connecting" | "connected" | "disconnected";
export const wsStatusAtom = atom<WsStatus>("disconnected");

// Signal data
export const tracesAtom = atom<TraceData[]>([]);
export const metricsAtom = atom<MetricData[]>([]);
export const logsAtom = atom<LogData[]>([]);

// Write-only: add single item from WebSocket
export const addTraceAtom = atom(null, (get, set, newTrace: TraceData) => {
  const current = get(tracesAtom);
  const maxTraces = get(serverConfigAtom).traceCap;
  const idx = current.findIndex((t) => t.traceId === newTrace.traceId);
  if (idx >= 0) {
    const existing = current[idx];
    const seen = new Set(existing.spans.map((s) => s.spanId));
    const deduped = newTrace.spans.filter((s) => !seen.has(s.spanId));
    const rootChanged = isBetterRoot(existing.rootSpan, newTrace.rootSpan);
    // OTel timestamps are nanosecond-precision ISO strings; compare via
    // Temporal.Instant to avoid Date's millisecond truncation.
    const newStart = Temporal.Instant.from(newTrace.startTime).epochNanoseconds;
    const existingStart = Temporal.Instant.from(existing.startTime).epochNanoseconds;
    if (
      deduped.length === 0 &&
      !rootChanged &&
      newTrace.duration <= existing.duration &&
      newStart >= existingStart
    ) {
      return;
    }
    const mergedSpans = [...existing.spans, ...deduped];
    const updated = [...current];
    updated[idx] = {
      ...existing,
      spans: mergedSpans,
      spanCount: mergedSpans.length,
      rootSpan: rootChanged ? newTrace.rootSpan : existing.rootSpan,
      serviceName: rootChanged ? newTrace.serviceName : existing.serviceName,
      // Multi-root Codex traces can grow past the originally-reported root
      // span duration. Always take the larger range so the list/detail
      // header reflect the full trace length.
      startTime: newStart < existingStart ? newTrace.startTime : existing.startTime,
      duration: Math.max(existing.duration, newTrace.duration),
    };
    set(tracesAtom, updated);
  } else {
    const next = [newTrace, ...current];
    set(tracesAtom, next.length > maxTraces ? next.slice(0, maxTraces) : next);
  }
});

// Picks the longest parentless span as the representative root for display.
function isBetterRoot(current: SpanData | undefined, candidate: SpanData | undefined): boolean {
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

export const addMetricAtom = atom(null, (get, set, newMetric: MetricData) => {
  const current = get(metricsAtom);
  const maxMetrics = get(serverConfigAtom).metricCap;
  const idx = current.findIndex((m) => metricKeyEquals(m, newMetric));
  if (idx >= 0) {
    const existing = current[idx];
    const updated = [...current];
    updated[idx] = {
      ...existing,
      dataPoints: mergeDataPoints(existing.dataPoints, newMetric.dataPoints).slice(
        -get(serverConfigAtom).maxDataPoints,
      ),
      receivedAt: newMetric.receivedAt,
    };
    set(metricsAtom, updated);
  } else {
    const next = [newMetric, ...current];
    set(metricsAtom, next.length > maxMetrics ? next.slice(0, maxMetrics) : next);
  }
});

export const addLogAtom = atom(null, (get, set, newLog: LogData) => {
  const maxLogs = get(serverConfigAtom).logCap;
  set(logsAtom, (prev) => {
    const next = [newLog, ...prev];
    return next.length > maxLogs ? next.slice(0, maxLogs) : next;
  });
});

// Counts for tab badges
export const traceCountAtom = atom((get) => get(tracesAtom).length);
export const metricCountAtom = atom((get) => get(metricsAtom).length);
export const logCountAtom = atom((get) => get(logsAtom).length);

// Clear all data
export const clearAllAtom = atom(null, (_get, set) => {
  set(tracesAtom, []);
  set(metricsAtom, []);
  set(logsAtom, []);
});

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

// Bulk set from REST API initial load
export const setTracesAtom = atom(null, (_get, set, traces: TraceData[]) => {
  set(tracesAtom, traces);
});
export const setMetricsAtom = atom(null, (_get, set, metrics: MetricData[]) => {
  set(metricsAtom, metrics);
});
export const setLogsAtom = atom(null, (_get, set, logs: LogData[]) => {
  set(logsAtom, logs);
});
