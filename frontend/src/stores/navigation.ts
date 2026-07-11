import { atom } from "jotai";
import type { Getter } from "jotai";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { SIGNALS } from "@/lib/signals";
import type { SignalKey } from "@/lib/signals";
import type { MetricData } from "@/types/telemetry";
import { DEFAULT_CHART_TIME_RANGE, isChartTimeRange } from "@/lib/chart-time-range";
import type { ChartTimeRange } from "@/lib/chart-time-range";

export type TabValue = SignalKey;

export type MetricKey = Pick<MetricData, "serviceName" | "name">;

interface ParsedLocation {
  tab: TabValue;
  traceId: string | null;
  metricKey: MetricKey | null;
  logId: string | null;
  // Only meaningful alongside metricKey (see buildPath); still resolved to a
  // valid value for every location so callers never have to null-check it.
  metricRange: ChartTimeRange;
  // Unlike metricRange, these scope the traces/logs LIST views themselves
  // (not a detail selection), so they apply to a bare /traces or /logs path
  // too — see buildPath.
  traceRange: ChartTimeRange;
  logRange: ChartTimeRange;
}

// Only the tab of the currently active screen is meaningful in the path; a
// traceId/metricKey/logId segment left over from another tab is ignored.
// Takes the full pathname + search (not just the pathname) so the metric
// detail's range survives reload/sharing via the `range` query param.
export function parsePath(location: string): ParsedLocation {
  const url = new URL(location, "http://otelop.invalid");
  const [first, second, third] = url.pathname.split("/").filter(Boolean);
  const tab: TabValue = first && first in SIGNALS ? (first as TabValue) : "traces";

  const rangeParam = url.searchParams.get("range");
  const validRange = rangeParam && isChartTimeRange(rangeParam) ? rangeParam : null;
  const metricRange: ChartTimeRange =
    tab === "metrics" && validRange ? validRange : DEFAULT_CHART_TIME_RANGE;
  const traceRange: ChartTimeRange =
    tab === "traces" && validRange ? validRange : DEFAULT_CHART_TIME_RANGE;
  const logRange: ChartTimeRange =
    tab === "logs" && validRange ? validRange : DEFAULT_CHART_TIME_RANGE;

  return {
    tab,
    traceId: tab === "traces" && second ? decodeURIComponent(second) : null,
    metricKey:
      tab === "metrics" && second && third
        ? { serviceName: decodeURIComponent(second), name: decodeURIComponent(third) }
        : null,
    logId: tab === "logs" && second ? decodeURIComponent(second) : null,
    metricRange,
    traceRange,
    logRange,
  };
}

// Takes a full ParsedLocation (rather than positional args) so it stays
// symmetric with parsePath as more selection kinds are added.
export function buildPath(location: ParsedLocation): string {
  const { tab, traceId, metricKey, logId, metricRange, traceRange, logRange } = location;
  // The range param is elided at the default so a list/detail view left at
  // "1h" keeps a clean URL, matching how the id/key selections below only
  // appear once a selection exists.
  if (tab === "traces") {
    const base = traceId ? `/traces/${encodeURIComponent(traceId)}` : "/traces";
    return traceRange === DEFAULT_CHART_TIME_RANGE
      ? base
      : `${base}?range=${encodeURIComponent(traceRange)}`;
  }
  if (tab === "metrics" && metricKey) {
    const base = `/metrics/${encodeURIComponent(metricKey.serviceName)}/${encodeURIComponent(metricKey.name)}`;
    return metricRange === DEFAULT_CHART_TIME_RANGE
      ? base
      : `${base}?range=${encodeURIComponent(metricRange)}`;
  }
  if (tab === "logs") {
    const base = logId ? `/logs/${encodeURIComponent(logId)}` : "/logs";
    return logRange === DEFAULT_CHART_TIME_RANGE
      ? base
      : `${base}?range=${encodeURIComponent(logRange)}`;
  }
  return `/${tab}`;
}

export function metricKeyEquals(a: MetricKey | null, b: MetricKey | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.serviceName === b.serviceName && a.name === b.name;
}

const initialLocation = parsePath(window.location.pathname + window.location.search);

const currentTabAtom = atom<TabValue>(initialLocation.tab);

const selectedTraceIdBaseAtom = atom<string | null>(initialLocation.traceId);
const selectedMetricKeyBaseAtom = atom<MetricKey | null>(initialLocation.metricKey);
const selectedLogIdBaseAtom = atom<string | null>(initialLocation.logId);
const selectedMetricRangeBaseAtom = atom<ChartTimeRange>(initialLocation.metricRange);
const selectedTraceRangeBaseAtom = atom<ChartTimeRange>(initialLocation.traceRange);
const selectedLogRangeBaseAtom = atom<ChartTimeRange>(initialLocation.logRange);

// Shared by every public writer so the URL always reflects the current
// tab + selection as a single pushState, and unchanged state never pushes.
function syncLocation(get: Getter): void {
  const path = buildPath({
    tab: get(currentTabAtom),
    traceId: get(selectedTraceIdBaseAtom),
    metricKey: get(selectedMetricKeyBaseAtom),
    logId: get(selectedLogIdBaseAtom),
    metricRange: get(selectedMetricRangeBaseAtom),
    traceRange: get(selectedTraceRangeBaseAtom),
    logRange: get(selectedLogRangeBaseAtom),
  });
  if (window.location.pathname + window.location.search !== path) {
    window.history.pushState(null, "", path);
  }
}

// Write-through atoms: writing the id/key also syncs the URL, so callers
// (telemetry.ts's selectedTraceAtom/selectedMetricAtom/selectedLogAtom) can't
// forget to.
export const selectedTraceIdAtom = atom(
  (get) => get(selectedTraceIdBaseAtom),
  (get, set, traceId: string | null) => {
    if (get(selectedTraceIdBaseAtom) === traceId) return;
    set(selectedTraceIdBaseAtom, traceId);
    syncLocation(get);
  },
);

export const selectedMetricKeyAtom = atom(
  (get) => get(selectedMetricKeyBaseAtom),
  (get, set, metricKey: MetricKey | null) => {
    if (metricKeyEquals(get(selectedMetricKeyBaseAtom), metricKey)) return;
    set(selectedMetricKeyBaseAtom, metricKey);
    syncLocation(get);
  },
);

export const selectedLogIdAtom = atom(
  (get) => get(selectedLogIdBaseAtom),
  (get, set, logId: string | null) => {
    if (get(selectedLogIdBaseAtom) === logId) return;
    set(selectedLogIdBaseAtom, logId);
    syncLocation(get);
  },
);

// Deliberate exception to "detail-internal selection stays local state": the
// range is what a shared metric-detail link should reproduce, so it's synced
// like the id/key atoms above. The facet breakdown is not — see
// metric-detail.tsx's local pickedId state.
export const selectedMetricRangeAtom = atom(
  (get) => get(selectedMetricRangeBaseAtom),
  (get, set, range: ChartTimeRange) => {
    if (get(selectedMetricRangeBaseAtom) === range) return;
    set(selectedMetricRangeBaseAtom, range);
    syncLocation(get);
  },
);

// Unlike selectedMetricRangeAtom, these scope the traces/logs tab's LIST
// view (hooks/use-trace-list-page.ts, hooks/use-log-list-page.ts) rather
// than a detail selection, so they round-trip through the URL regardless of
// whether a trace/log is currently selected — see buildPath.
export const selectedTraceRangeAtom = atom(
  (get) => get(selectedTraceRangeBaseAtom),
  (get, set, range: ChartTimeRange) => {
    if (get(selectedTraceRangeBaseAtom) === range) return;
    set(selectedTraceRangeBaseAtom, range);
    syncLocation(get);
  },
);

export const selectedLogRangeAtom = atom(
  (get) => get(selectedLogRangeBaseAtom),
  (get, set, range: ChartTimeRange) => {
    if (get(selectedLogRangeBaseAtom) === range) return;
    set(selectedLogRangeBaseAtom, range);
    syncLocation(get);
  },
);

// The tab/selection combo is mirrored to the URL so a reload (or shared link)
// restores the same screen even though the telemetry data itself is volatile.
export const activeTabAtom = atom(
  (get) => get(currentTabAtom),
  (get, set, tab: TabValue) => {
    if (get(currentTabAtom) === tab) return;
    set(currentTabAtom, tab);
    syncLocation(get);
  },
);

// Applies a browser-navigated (or restored) path to state without touching
// history — history already reflects this path, pushing again would loop.
// Only the tab matching the path's selection is updated; a selection held by
// another tab is left as-is so switching back restores it. Takes the full
// pathname + search (see parsePath) so the metric range round-trips too.
export const applyLocationAtom = atom(null, (_get, set, location: string) => {
  const parsed = parsePath(location);
  set(currentTabAtom, parsed.tab);
  if (parsed.tab === "traces") {
    set(selectedTraceIdBaseAtom, parsed.traceId);
    set(selectedTraceRangeBaseAtom, parsed.traceRange);
  }
  if (parsed.tab === "metrics") {
    set(selectedMetricKeyBaseAtom, parsed.metricKey);
    set(selectedMetricRangeBaseAtom, parsed.metricRange);
  }
  if (parsed.tab === "logs") {
    set(selectedLogIdBaseAtom, parsed.logId);
    set(selectedLogRangeBaseAtom, parsed.logRange);
  }
});

// Keeps state in sync with browser back/forward navigation. Mounted once at
// the app root (unlike the old currentTabAtom.onMount, this also restores
// trace/metric selection, so it must run for the lifetime of the app).
export function useLocationSync(): void {
  const applyLocation = useSetAtom(applyLocationAtom);

  useEffect(() => {
    const onPopState = () => applyLocation(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyLocation]);
}
