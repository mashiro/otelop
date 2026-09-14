import { Temporal } from "temporal-polyfill";
import { DEFAULT_CHART_TIME_RANGE } from "./chart-time-range";
import type { EventTimeWindow } from "./event-time-window";
import { isChartTimeRange, type ChartTimeRange } from "./chart-time-range";

export interface SignalSearch {
  q?: string;
  range?: ChartTimeRange;
  from?: string;
  to?: string;
  filter?: string[];
  disabled_filter?: string[];
}

// Keep shared URLs compatible with repeated filter= / disabled_filter= keys.
export function parseSearch(search: string): Record<string, unknown> {
  const params = new URLSearchParams(search);
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => [
      key,
      key === "filter" || key === "disabled_filter" ? params.getAll(key) : params.get(key),
    ]),
  );
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}

export function validateSearch(search: Record<string, unknown>): SignalSearch {
  const text = (key: string) => (typeof search[key] === "string" ? search[key] : undefined);
  const filters = (key: string) => {
    const value = search[key];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : typeof value === "string"
        ? [value]
        : undefined;
  };
  const range = text("range");
  return {
    q: text("q"),
    range: range && isChartTimeRange(range) ? range : undefined,
    from: text("from"),
    to: text("to"),
    filter: filters("filter"),
    disabled_filter: filters("disabled_filter"),
  };
}

export function eventWindowFromSearch(search: SignalSearch): EventTimeWindow {
  const { from, to } = search;
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
  return { mode: "live", range: search.range ?? DEFAULT_CHART_TIME_RANGE };
}

export function eventWindowSearch(
  window: EventTimeWindow,
): Pick<SignalSearch, "range" | "from" | "to"> {
  return window.mode === "fixed"
    ? { from: window.from, to: window.to, range: undefined }
    : {
        from: undefined,
        to: undefined,
        range: window.range === DEFAULT_CHART_TIME_RANGE ? undefined : window.range,
      };
}
