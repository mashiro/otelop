import { atom } from "jotai";
import type { TraceData, MetricData, LogData } from "@/types/telemetry";

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
  const idx = current.findIndex((t) => t.traceID === newTrace.traceID);
  if (idx >= 0) {
    const existing = current[idx];
    const updated = [...current];
    updated[idx] = {
      ...existing,
      spans: [...existing.spans, ...newTrace.spans],
      spanCount: existing.spans.length + newTrace.spans.length,
      rootSpan: newTrace.rootSpan ?? existing.rootSpan,
      serviceName: newTrace.rootSpan ? newTrace.serviceName : existing.serviceName,
      duration: newTrace.rootSpan ? newTrace.duration : existing.duration,
    };
    set(tracesAtom, updated);
  } else {
    set(tracesAtom, [newTrace, ...current]);
  }
});

export const addMetricAtom = atom(null, (get, set, newMetric: MetricData) => {
  const current = get(metricsAtom);
  const idx = current.findIndex(
    (m) => m.serviceName === newMetric.serviceName && m.name === newMetric.name,
  );
  if (idx >= 0) {
    const existing = current[idx];
    const updated = [...current];
    updated[idx] = {
      ...existing,
      dataPoints: [...existing.dataPoints, ...newMetric.dataPoints],
      receivedAt: newMetric.receivedAt,
    };
    set(metricsAtom, updated);
  } else {
    set(metricsAtom, [newMetric, ...current]);
  }
});

export const addLogAtom = atom(null, (_get, set, newLog: LogData) => {
  set(logsAtom, (prev) => [newLog, ...prev]);
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
export const selectedMetricAtom = atom<MetricData | null>(null);
export const selectedLogAtom = atom<LogData | null>(null);

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
