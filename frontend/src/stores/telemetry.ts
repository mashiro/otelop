import { atom } from "jotai";
import type { TraceData, MetricData, LogData } from "@/types/telemetry";

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
  logCap: 1000,
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
  const idx = current.findIndex((t) => t.traceID === newTrace.traceID);
  if (idx >= 0) {
    const existing = current[idx];
    const seen = new Set(existing.spans.map((s) => s.spanID));
    const deduped = newTrace.spans.filter((s) => !seen.has(s.spanID));
    if (deduped.length === 0 && !newTrace.rootSpan) return;
    const mergedSpans = [...existing.spans, ...deduped];
    const updated = [...current];
    updated[idx] = {
      ...existing,
      spans: mergedSpans,
      spanCount: mergedSpans.length,
      rootSpan: newTrace.rootSpan ?? existing.rootSpan,
      serviceName: newTrace.rootSpan ? newTrace.serviceName : existing.serviceName,
      duration: newTrace.rootSpan ? newTrace.duration : existing.duration,
    };
    set(tracesAtom, updated);
  } else {
    const next = [newTrace, ...current];
    set(tracesAtom, next.length > maxTraces ? next.slice(0, maxTraces) : next);
  }
});

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

// Log filter by traceID (set when jumping from trace → logs)
export const logTraceFilterAtom = atom<string | null>(null);

// Navigate: log → trace (find trace by ID and switch tab)
export const navigateToTraceAtom = atom(null, (get, set, traceID: string) => {
  const traces = get(tracesAtom);
  const trace = traces.find((t) => t.traceID === traceID);
  if (trace) {
    set(selectedTraceAtom, trace);
    set(activeTabAtom, "traces");
  }
});

// Navigate: trace → related logs (switch to logs tab with filter)
export const navigateToLogsAtom = atom(null, (_get, set, traceID: string) => {
  set(logTraceFilterAtom, traceID);
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
