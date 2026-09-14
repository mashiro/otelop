import { traceSearchAtom } from "./trace-query";
import { metricSearchAtom } from "./navigation";
import { createTraceSearchMatcher } from "@/lib/trace-search";
import { logSearchAtom } from "./log-query";
import { createLogSearchMatcher } from "@/lib/log-search";
import { atom } from "jotai";

import { filterDataPointsInRange } from "@/lib/chart-time-range";
import { parseEpochNs } from "@/lib/normalize";
import { eventWindowBounds } from "@/lib/event-time-window";
import {
  tracesAtom,
  metricsAtom,
  logsAtom,
  serverMatchedTraceIdsAtom,
  serverMatchedLogIdsAtom,
  loadedOlderTraceIdsAtom,
  loadedOlderLogIdsAtom,
  metricSearchResultAtom,
  traceListWindowAtom,
  logListWindowAtom,
} from "./telemetry";
import { metricKeyToString } from "./navigation";
import type { MetricData, LogData } from "@/types/telemetry";

export { traceSearchAtom } from "./trace-query";
export { metricSearchAtom } from "./navigation";

// The live-tail display filter (issue #160): tracesAtom already only holds
// what was server-paginated within the selected range plus whatever the
// WebSocket has prepended since — but a session left open past the range's
// length would otherwise keep showing paged-in rows that have aged out of
// "the last <range>". Anchoring on the max loaded startTime (not wall-clock)
// mirrors the metric chart's rolling window (see metric-detail.tsx's
// windowedDataPoints) and keeps re-deriving the true visible window as new
// data arrives.
//
// fromNs/toNs are parsed once by the caller (outside the per-row filter),
// not per row — epochNs itself is already a pre-parsed view-model field (see
// lib/normalize.ts), so this whole check is pure bigint comparison.
function inEventWindow(epochNs: bigint, fromNs: bigint | undefined, toNs: bigint): boolean {
  return (fromNs === undefined || epochNs >= fromNs) && epochNs < toNs;
}

const rangeFilteredTracesAtom = atom((get) => {
  const window = get(traceListWindowAtom);
  const traces = get(tracesAtom);
  const loadedOlderIds = get(traceSearchAtom).trim()
    ? new Set<string>()
    : get(loadedOlderTraceIdsAtom);
  if (window.mode === "live") {
    if (window.range === "all") return traces;
    const inRangeIds = new Set(
      filterDataPointsInRange(traces, window.range, (trace) => trace.startEpochNs).map(
        (trace) => trace.traceId,
      ),
    );
    return traces.filter(
      (trace) => loadedOlderIds.has(trace.traceId) || inRangeIds.has(trace.traceId),
    );
  }
  const { from, to } = eventWindowBounds(window);
  const fromNs = from === undefined ? undefined : parseEpochNs(from);
  const toNs = parseEpochNs(to);
  return traces.filter(
    (trace) => loadedOlderIds.has(trace.traceId) || inEventWindow(trace.startEpochNs, fromNs, toNs),
  );
});

const searchedTracesAtom = atom((get) => {
  const matches = createTraceSearchMatcher(get(traceSearchAtom).trim());
  const serverIds = get(serverMatchedTraceIdsAtom);
  return get(rangeFilteredTracesAtom).filter(
    (trace) => serverIds.has(trace.traceId) || matches(trace),
  );
});

export const filteredTracesAtom = atom((get) =>
  get(traceSearchAtom).trim() ? get(searchedTracesAtom) : get(rangeFilteredTracesAtom),
);

export { logSearchAtom } from "./log-query";

// See rangeFilteredTracesAtom above — same live-tail rolling-window rationale.
const rangeFilteredLogsAtom = atom((get) => {
  const window = get(logListWindowAtom);
  const logs = get(logsAtom);
  const loadedOlderIds = get(logSearchAtom).trim() ? new Set<string>() : get(loadedOlderLogIdsAtom);
  if (window.mode === "live") {
    if (window.range === "all") return logs;
    const inRangeIds = new Set(
      filterDataPointsInRange(logs, window.range, (log) => log.epochNs).map((log) => log.id),
    );
    return logs.filter((log) => loadedOlderIds.has(log.id) || inRangeIds.has(log.id));
  }
  const { from, to } = eventWindowBounds(window);
  const fromNs = from === undefined ? undefined : parseEpochNs(from);
  const toNs = parseEpochNs(to);
  return get(logsAtom).filter(
    (log) => loadedOlderIds.has(log.id) || inEventWindow(log.epochNs, fromNs, toNs),
  );
});

// Server results already match; apply the same grammar to live arrivals.
const searchedLogsAtom = atom((get) => {
  const matches = createLogSearchMatcher(get(logSearchAtom).trim());
  const serverIds = get(serverMatchedLogIdsAtom);
  return get(rangeFilteredLogsAtom).filter((log) => serverIds.has(log.id) || matches(log));
});

export const filteredLogsAtom = atom<LogData[]>((get) =>
  get(logSearchAtom).trim() ? get(searchedLogsAtom) : get(rangeFilteredLogsAtom),
);

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
    if (metric.name.toLowerCase().includes(q)) matches.push(metric);
  }
  return matches;
});
