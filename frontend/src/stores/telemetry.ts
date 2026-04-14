import { atom } from "jotai";
import { Temporal } from "temporal-polyfill";
import type { TraceData, MetricData, LogData, SpanData } from "@/types/telemetry";

// Server-side capacity config, fetched at startup.
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

export const addMetricAtom = atom(null, (get, set, newMetric: MetricData) => {
  const current = get(metricsAtom);
  const maxMetrics = get(serverConfigAtom).metricCap;
  const idx = current.findIndex(
    (m) => m.serviceName === newMetric.serviceName && m.name === newMetric.name,
  );
  if (idx >= 0) {
    const existing = current[idx];
    const updated = [...current];
    updated[idx] = {
      ...existing,
      dataPoints: [...existing.dataPoints, ...newMetric.dataPoints].slice(
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

// Selection state
export const selectedTraceAtom = atom<TraceData | null>(null);

type MetricKey = Pick<MetricData, "serviceName" | "name">;
const selectedMetricKeyAtom = atom<MetricKey | null>(null);

export const selectedMetricAtom = atom(
  (get) => {
    const key = get(selectedMetricKeyAtom);
    if (!key) return null;
    return (
      get(metricsAtom).find((m) => m.serviceName === key.serviceName && m.name === key.name) ?? null
    );
  },
  (_get, set, metric: MetricData | null) => {
    set(
      selectedMetricKeyAtom,
      metric ? { serviceName: metric.serviceName, name: metric.name } : null,
    );
  },
);

export const selectedLogAtom = atom<LogData | null>(null);

// Active tab
export type TabValue = "traces" | "metrics" | "logs";
export const activeTabAtom = atom<TabValue>("traces");

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
