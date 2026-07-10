import { atom } from "jotai";
import type { Getter } from "jotai";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { SIGNALS } from "@/lib/signals";
import type { SignalKey } from "@/lib/signals";
import type { MetricData } from "@/types/telemetry";

export type TabValue = SignalKey;

export type MetricKey = Pick<MetricData, "serviceName" | "name">;

interface ParsedLocation {
  tab: TabValue;
  traceId: string | null;
  metricKey: MetricKey | null;
  logId: string | null;
}

// Only the tab of the currently active screen is meaningful in the path; a
// traceId/metricKey/logId segment left over from another tab is ignored.
export function parsePath(pathname: string): ParsedLocation {
  const [first, second, third] = pathname.split("/").filter(Boolean);
  const tab: TabValue = first && first in SIGNALS ? (first as TabValue) : "traces";

  return {
    tab,
    traceId: tab === "traces" && second ? decodeURIComponent(second) : null,
    metricKey:
      tab === "metrics" && second && third
        ? { serviceName: decodeURIComponent(second), name: decodeURIComponent(third) }
        : null,
    logId: tab === "logs" && second ? decodeURIComponent(second) : null,
  };
}

// Takes a full ParsedLocation (rather than positional args) so it stays
// symmetric with parsePath as more selection kinds are added.
export function buildPath(location: ParsedLocation): string {
  const { tab, traceId, metricKey, logId } = location;
  if (tab === "traces" && traceId) return `/traces/${encodeURIComponent(traceId)}`;
  if (tab === "metrics" && metricKey) {
    return `/metrics/${encodeURIComponent(metricKey.serviceName)}/${encodeURIComponent(metricKey.name)}`;
  }
  if (tab === "logs" && logId) return `/logs/${encodeURIComponent(logId)}`;
  return `/${tab}`;
}

export function metricKeyEquals(a: MetricKey | null, b: MetricKey | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.serviceName === b.serviceName && a.name === b.name;
}

const initialLocation = parsePath(window.location.pathname);

const currentTabAtom = atom<TabValue>(initialLocation.tab);

const selectedTraceIdBaseAtom = atom<string | null>(initialLocation.traceId);
const selectedMetricKeyBaseAtom = atom<MetricKey | null>(initialLocation.metricKey);
const selectedLogIdBaseAtom = atom<string | null>(initialLocation.logId);

// Shared by every public writer so the URL always reflects the current
// tab + selection as a single pushState, and unchanged state never pushes.
function syncLocation(get: Getter): void {
  const path = buildPath({
    tab: get(currentTabAtom),
    traceId: get(selectedTraceIdBaseAtom),
    metricKey: get(selectedMetricKeyBaseAtom),
    logId: get(selectedLogIdBaseAtom),
  });
  if (window.location.pathname !== path) {
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
// another tab is left as-is so switching back restores it.
export const applyLocationAtom = atom(null, (_get, set, pathname: string) => {
  const parsed = parsePath(pathname);
  set(currentTabAtom, parsed.tab);
  if (parsed.tab === "traces") {
    set(selectedTraceIdBaseAtom, parsed.traceId);
  }
  if (parsed.tab === "metrics") {
    set(selectedMetricKeyBaseAtom, parsed.metricKey);
  }
  if (parsed.tab === "logs") {
    set(selectedLogIdBaseAtom, parsed.logId);
  }
});

// Keeps state in sync with browser back/forward navigation. Mounted once at
// the app root (unlike the old currentTabAtom.onMount, this also restores
// trace/metric selection, so it must run for the lifetime of the app).
export function useLocationSync(): void {
  const applyLocation = useSetAtom(applyLocationAtom);

  useEffect(() => {
    const onPopState = () => applyLocation(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyLocation]);
}
