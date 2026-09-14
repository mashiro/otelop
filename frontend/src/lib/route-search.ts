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
