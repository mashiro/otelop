import { atom } from "jotai";
import type { Atom, PrimitiveAtom } from "jotai";
import { filterDataPointsInRange } from "@/lib/chart-time-range";
import { selectedLogRangeAtom, selectedTraceRangeAtom } from "./navigation";
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

// The live-tail display filter (issue #160): tracesAtom already only holds
// what was server-paginated within the selected range plus whatever the
// WebSocket has prepended since — but a session left open past the range's
// length would otherwise keep showing paged-in rows that have aged out of
// "the last <range>". Anchoring on the max loaded startTime (not wall-clock)
// mirrors the metric chart's rolling window (see metric-detail.tsx's
// windowedDataPoints) and keeps re-deriving the true visible window as new
// data arrives.
const rangeFilteredTracesAtom = atom((get) =>
  filterDataPointsInRange(get(tracesAtom), get(selectedTraceRangeAtom), (t) => t.startTime),
);

export const filteredTracesAtom = createSearchAtom(
  rangeFilteredTracesAtom,
  traceSearchAtom,
  (t: TraceData) => [
    t.rootSpan?.name ?? t.spans[0]?.name ?? "",
    t.serviceName ?? "",
    t.traceId,
    t.rootSpan?.statusCode ?? "Unset",
  ],
);

export const logSearchAtom = atom("");

// See rangeFilteredTracesAtom above — same live-tail rolling-window rationale.
const rangeFilteredLogsAtom = atom((get) =>
  filterDataPointsInRange(get(logsAtom), get(selectedLogRangeAtom)),
);

const filteredLogsBySearchAtom = createSearchAtom(
  rangeFilteredLogsAtom,
  logSearchAtom,
  (l: LogData) => [l.body, l.serviceName ?? "", l.severityText ?? "", l.traceId],
);

export const filteredLogsAtom = atom<LogData[]>((get) => {
  const traceFilter = get(logTraceFilterAtom);
  const logs = get(filteredLogsBySearchAtom);
  if (!traceFilter) return logs;
  return logs.filter((l) => l.traceId === traceFilter);
});

export const metricSearchAtom = atom("");

export const filteredMetricsAtom = createSearchAtom(
  metricsAtom,
  metricSearchAtom,
  (m: MetricData) => [m.name, m.serviceName ?? "", m.type, m.description ?? ""],
);
