import { atom } from "jotai";
import { tracesAtom, metricsAtom, logsAtom, logTraceFilterAtom } from "./telemetry";
import type { TraceData, MetricData, LogData } from "@/types/telemetry";

// --- Trace Filters ---

export const traceSearchAtom = atom("");

export const filteredTracesAtom = atom<TraceData[]>((get) => {
  const traces = get(tracesAtom);
  const search = get(traceSearchAtom);
  if (!search) return traces;
  const q = search.toLowerCase();
  return traces.filter((t) => {
    const name = (t.rootSpan?.name ?? t.spans[0]?.name ?? "").toLowerCase();
    const svc = (t.serviceName ?? "").toLowerCase();
    const traceID = t.traceID.toLowerCase();
    return name.includes(q) || svc.includes(q) || traceID.includes(q);
  });
});

// --- Log Filters ---

export const logSearchAtom = atom("");

export const filteredLogsAtom = atom<LogData[]>((get) => {
  const logs = get(logsAtom);
  const traceFilter = get(logTraceFilterAtom);
  const search = get(logSearchAtom);
  let result = traceFilter ? logs.filter((l) => l.traceID === traceFilter) : logs;
  if (!search) return result;
  const q = search.toLowerCase();
  return result.filter((l) => {
    const body = l.body.toLowerCase();
    const svc = (l.serviceName ?? "").toLowerCase();
    const sev = (l.severityText ?? "").toLowerCase();
    return body.includes(q) || svc.includes(q) || sev.includes(q);
  });
});

// --- Metric Filters ---

export const metricSearchAtom = atom("");

export const filteredMetricsAtom = atom<MetricData[]>((get) => {
  const metrics = get(metricsAtom);
  const search = get(metricSearchAtom);
  if (!search) return metrics;
  const q = search.toLowerCase();
  return metrics.filter((m) => {
    const name = m.name.toLowerCase();
    const svc = (m.serviceName ?? "").toLowerCase();
    const type = m.type.toLowerCase();
    return name.includes(q) || svc.includes(q) || type.includes(q);
  });
});
