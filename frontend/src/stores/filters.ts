import { atom } from "jotai";
import { tracesAtom, metricsAtom, logsAtom, logTraceFilterAtom } from "./telemetry";
import type { TraceData, MetricData, LogData } from "@/types/telemetry";

// --- Trace Filters ---

export interface TraceFilters {
  search: string;
  status: Set<string>;
  durationMin: number | null;
  durationMax: number | null;
}

export const traceFiltersAtom = atom<TraceFilters>({
  search: "",
  status: new Set(),
  durationMin: null,
  durationMax: null,
});

function matchesTraceFilter(t: TraceData, f: TraceFilters): boolean {
  if (f.search) {
    const q = f.search.toLowerCase();
    const name = (t.rootSpan?.name ?? t.spans[0]?.name ?? "").toLowerCase();
    const svc = (t.serviceName ?? "").toLowerCase();
    if (!name.includes(q) && !svc.includes(q)) return false;
  }
  if (f.status.size > 0) {
    const s = t.rootSpan?.statusCode ?? "Unset";
    if (!f.status.has(s)) return false;
  }
  if (f.durationMin !== null && t.duration < f.durationMin) return false;
  if (f.durationMax !== null && t.duration > f.durationMax) return false;
  return true;
}

export const filteredTracesAtom = atom<TraceData[]>((get) => {
  const traces = get(tracesAtom);
  const f = get(traceFiltersAtom);
  if (!f.search && f.status.size === 0 && f.durationMin === null && f.durationMax === null) {
    return traces;
  }
  return traces.filter((t) => matchesTraceFilter(t, f));
});

// --- Log Filters ---

export interface LogFilters {
  search: string;
  severity: Set<string>;
  service: string;
}

export const logFiltersAtom = atom<LogFilters>({
  search: "",
  severity: new Set(),
  service: "",
});

function matchesLogFilter(l: LogData, f: LogFilters): boolean {
  if (f.search) {
    const q = f.search.toLowerCase();
    if (!l.body.toLowerCase().includes(q)) return false;
  }
  if (f.severity.size > 0 && !f.severity.has(l.severityText)) return false;
  if (f.service) {
    if (!(l.serviceName ?? "").toLowerCase().includes(f.service.toLowerCase())) return false;
  }
  return true;
}

export const filteredLogsAtom = atom<LogData[]>((get) => {
  const logs = get(logsAtom);
  const traceFilter = get(logTraceFilterAtom);
  const f = get(logFiltersAtom);
  let result = traceFilter ? logs.filter((l) => l.traceID === traceFilter) : logs;
  if (!f.search && f.severity.size === 0 && !f.service) return result;
  return result.filter((l) => matchesLogFilter(l, f));
});

// --- Metric Filters ---

export interface MetricFilters {
  search: string;
  type: Set<string>;
}

export const metricFiltersAtom = atom<MetricFilters>({
  search: "",
  type: new Set(),
});

function matchesMetricFilter(m: MetricData, f: MetricFilters): boolean {
  if (f.search && !m.name.toLowerCase().includes(f.search.toLowerCase())) return false;
  if (f.type.size > 0 && !f.type.has(m.type)) return false;
  return true;
}

export const filteredMetricsAtom = atom<MetricData[]>((get) => {
  const metrics = get(metricsAtom);
  const f = get(metricFiltersAtom);
  if (!f.search && f.type.size === 0) return metrics;
  return metrics.filter((m) => matchesMetricFilter(m, f));
});
