import { atom } from "jotai";
import type { Atom, PrimitiveAtom } from "jotai";
import { tracesAtom, metricsAtom, logsAtom, logTraceFilterAtom } from "./telemetry";
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

export const traceSearchAtom = atom("");

export const filteredTracesAtom = createSearchAtom(tracesAtom, traceSearchAtom, (t: TraceData) => [
  t.rootSpan?.name ?? t.spans[0]?.name ?? "",
  t.serviceName ?? "",
  t.traceID,
  t.rootSpan?.statusCode ?? "Unset",
]);

export const logSearchAtom = atom("");

const filteredLogsBySearchAtom = createSearchAtom(logsAtom, logSearchAtom, (l: LogData) => [
  l.body,
  l.serviceName ?? "",
  l.severityText ?? "",
  l.traceID,
]);

export const filteredLogsAtom = atom<LogData[]>((get) => {
  const traceFilter = get(logTraceFilterAtom);
  const logs = get(filteredLogsBySearchAtom);
  if (!traceFilter) return logs;
  return logs.filter((l) => l.traceID === traceFilter);
});

export const metricSearchAtom = atom("");

export const filteredMetricsAtom = createSearchAtom(
  metricsAtom,
  metricSearchAtom,
  (m: MetricData) => [m.name, m.serviceName ?? "", m.type, m.description ?? ""],
);
