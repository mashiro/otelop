import { atom } from "jotai";
import type { Getter, PrimitiveAtom } from "jotai";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { Temporal } from "temporal-polyfill";
import { SIGNALS } from "@/lib/signals";
import type { SignalKey } from "@/lib/signals";
import type { MetricData } from "@/types/telemetry";
import { DEFAULT_CHART_TIME_RANGE, isChartTimeRange } from "@/lib/chart-time-range";
import type { ChartTimeRange } from "@/lib/chart-time-range";
import { eventWindowEquals, type EventTimeWindow } from "@/lib/event-time-window";

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

// String encoding of a MetricKey for use as a Set/Map key (e.g.
// stores/telemetry.ts's metricSearchResultAtom) — metrics have no single
// id field the way traces/logs do (traceId/log id), only this compound key.
// JSON-encoding the tuple (rather than joining with a delimiter) sidesteps
// picking a separator that can't collide with characters serviceName/name
// might contain.
export function metricKeyToString(key: MetricKey): string {
  return JSON.stringify([key.serviceName ?? "", key.name]);
}

const initialLocation = parsePath(window.location.pathname + window.location.search);

function eventWindowFromLocation(location: string, fallbackRange: ChartTimeRange): EventTimeWindow {
  const url = new URL(location, "http://otelop.invalid");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from && to) {
    try {
      const fromInstant = Temporal.Instant.from(from);
      const toInstant = Temporal.Instant.from(to);
      if (Temporal.Instant.compare(fromInstant, toInstant) < 0) {
        return { mode: "fixed", from: fromInstant.toString(), to: toInstant.toString() };
      }
    } catch {
      // Invalid or incomplete bounds fall back to the relative live window.
    }
  }
  return { mode: "live", range: fallbackRange };
}

const currentTabAtom = atom<TabValue>(initialLocation.tab);

const selectedTraceIdBaseAtom = atom<string | null>(initialLocation.traceId);
const selectedMetricKeyBaseAtom = atom<MetricKey | null>(initialLocation.metricKey);
const selectedLogIdBaseAtom = atom<string | null>(initialLocation.logId);
const selectedMetricRangeBaseAtom = atom<ChartTimeRange>(initialLocation.metricRange);
const metricTimeWindowBaseAtom = atom<EventTimeWindow>(
  initialLocation.tab === "metrics"
    ? eventWindowFromLocation(
        window.location.pathname + window.location.search,
        initialLocation.metricRange,
      )
    : { mode: "live", range: initialLocation.metricRange },
);
const initialEventRange =
  initialLocation.tab === "logs" ? initialLocation.logRange : initialLocation.traceRange;
const selectedEventRangeBaseAtom = atom<ChartTimeRange>(initialEventRange);
const eventTimeWindowBaseAtom = atom<EventTimeWindow>(
  eventWindowFromLocation(window.location.pathname + window.location.search, initialEventRange),
);

// Shared by every public writer so the URL always reflects the current
// tab + selection as a single pushState, and unchanged state never pushes.
function syncLocation(get: Getter): void {
  let path = buildPath({
    tab: get(currentTabAtom),
    traceId: get(selectedTraceIdBaseAtom),
    metricKey: get(selectedMetricKeyBaseAtom),
    logId: get(selectedLogIdBaseAtom),
    metricRange: get(selectedMetricRangeBaseAtom),
    traceRange: get(selectedEventRangeBaseAtom),
    logRange: get(selectedEventRangeBaseAtom),
  });
  const tab = get(currentTabAtom);
  const eventWindow = get(eventTimeWindowBaseAtom);
  const metricWindow = get(metricTimeWindowBaseAtom);
  if (tab === "metrics" && get(selectedMetricKeyBaseAtom) && metricWindow.mode === "fixed") {
    const url = new URL(path, "http://otelop.invalid");
    url.searchParams.delete("range");
    url.searchParams.set("from", metricWindow.from);
    url.searchParams.set("to", metricWindow.to);
    path = url.pathname + url.search;
  }
  if ((tab === "traces" || tab === "logs") && eventWindow.mode === "fixed") {
    const url = new URL(path, "http://otelop.invalid");
    url.searchParams.delete("range");
    url.searchParams.set("from", eventWindow.from);
    url.searchParams.set("to", eventWindow.to);
    path = url.pathname + url.search;
  }
  if (window.location.pathname + window.location.search !== path) {
    window.history.pushState(null, "", path);
  }
}

// createSyncedAtom is the shared "if equal return; set base; syncLocation"
// write-through wrapper every public selection/range/tab atom below needs, so
// callers (telemetry.ts's selectedTraceAtom/selectedMetricAtom/
// selectedLogAtom, and every range Tabs component) can't forget to sync the
// URL on write. `equals` defaults to `===`, which is correct for every base
// atom here except selectedMetricKeyBaseAtom (an object), which passes
// metricKeyEquals explicitly.
function createSyncedAtom<T>(
  baseAtom: PrimitiveAtom<T>,
  equals: (a: T, b: T) => boolean = (a, b) => a === b,
) {
  return atom(
    (get) => get(baseAtom),
    (get, set, value: T) => {
      if (equals(get(baseAtom), value)) return;
      set(baseAtom, value);
      syncLocation(get);
    },
  );
}

// Write-through atoms: writing the id/key also syncs the URL, so callers
// (telemetry.ts's selectedTraceAtom/selectedMetricAtom/selectedLogAtom) can't
// forget to.
export const selectedTraceIdAtom = createSyncedAtom(selectedTraceIdBaseAtom);

export const selectedMetricKeyAtom = createSyncedAtom(selectedMetricKeyBaseAtom, metricKeyEquals);

export const selectedLogIdAtom = createSyncedAtom(selectedLogIdBaseAtom);

// Deliberate exception to "detail-internal selection stays local state": the
// range is what a shared metric-detail link should reproduce, so it's synced
// like the id/key atoms above. The facet breakdown is not — see
// metric-detail.tsx's local pickedId state.
export const selectedMetricRangeAtom = atom(
  (get) => get(selectedMetricRangeBaseAtom),
  (get, set, value: ChartTimeRange) => {
    if (
      get(selectedMetricRangeBaseAtom) === value &&
      get(metricTimeWindowBaseAtom).mode === "live"
    ) {
      return;
    }
    set(selectedMetricRangeBaseAtom, value);
    set(metricTimeWindowBaseAtom, { mode: "live", range: value });
    syncLocation(get);
  },
);

export const metricTimeWindowAtom = atom(
  (get) => get(metricTimeWindowBaseAtom),
  (get, set, value: EventTimeWindow) => {
    if (eventWindowEquals(get(metricTimeWindowBaseAtom), value)) return;
    set(metricTimeWindowBaseAtom, value);
    if (value.mode === "live") set(selectedMetricRangeBaseAtom, value.range);
    syncLocation(get);
  },
);

// Unlike selectedMetricRangeAtom, these scope the traces/logs tab's LIST
// view (hooks/use-trace-list-page.ts, hooks/use-log-list-page.ts) rather
// than a detail selection, so they round-trip through the URL regardless of
// whether a trace/log is currently selected — see buildPath.
const selectedEventRangeAtom = atom(
  (get) => get(selectedEventRangeBaseAtom),
  (get, set, value: ChartTimeRange) => {
    if (get(selectedEventRangeBaseAtom) === value && get(eventTimeWindowBaseAtom).mode === "live") {
      return;
    }
    set(selectedEventRangeBaseAtom, value);
    set(eventTimeWindowBaseAtom, { mode: "live", range: value });
    syncLocation(get);
  },
);

export const selectedTraceRangeAtom = selectedEventRangeAtom;

export const selectedLogRangeAtom = selectedEventRangeAtom;

export const eventTimeWindowAtom = atom(
  (get) => get(eventTimeWindowBaseAtom),
  (get, set, value: EventTimeWindow) => {
    if (eventWindowEquals(get(eventTimeWindowBaseAtom), value)) return;
    set(eventTimeWindowBaseAtom, value);
    if (value.mode === "live") set(selectedEventRangeBaseAtom, value.range);
    syncLocation(get);
  },
);

// The tab/selection combo is mirrored to the URL so a reload (or shared link)
// restores the same screen even though the telemetry data itself is volatile.
export const activeTabAtom = createSyncedAtom(currentTabAtom);

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
    set(selectedEventRangeBaseAtom, parsed.traceRange);
    set(eventTimeWindowBaseAtom, eventWindowFromLocation(location, parsed.traceRange));
  }
  if (parsed.tab === "metrics") {
    set(selectedMetricKeyBaseAtom, parsed.metricKey);
    set(selectedMetricRangeBaseAtom, parsed.metricRange);
    set(metricTimeWindowBaseAtom, eventWindowFromLocation(location, parsed.metricRange));
  }
  if (parsed.tab === "logs") {
    set(selectedLogIdBaseAtom, parsed.logId);
    set(selectedEventRangeBaseAtom, parsed.logRange);
    set(eventTimeWindowBaseAtom, eventWindowFromLocation(location, parsed.logRange));
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
