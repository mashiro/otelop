import { Temporal } from "temporal-polyfill";

export type ChartTimeRange = "1m" | "5m" | "15m" | "30m" | "1h" | "all";

export const CHART_TIME_RANGES: { value: ChartTimeRange; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "all", label: "All" },
];

const RANGE_MINUTES: Record<Exclude<ChartTimeRange, "all">, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
};

export function rangeToMs(range: ChartTimeRange): number | null {
  if (range === "all") return null;
  return RANGE_MINUTES[range] * 60_000;
}

// Anchored on the max data timestamp (not Date.now()) so the chart keeps
// showing the last window of data instead of going blank once data stops
// arriving.
export function timeRangeDomain(
  points: { time: Date }[],
  range: ChartTimeRange,
): [Date, Date] | null {
  if (points.length === 0) return null;

  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const p of points) {
    const t = p.time.getTime();
    if (t < minMs) minMs = t;
    if (t > maxMs) maxMs = t;
  }

  const rangeMs = rangeToMs(range);
  if (rangeMs === null) return [new Date(minMs), new Date(maxMs)];
  return [new Date(maxMs - rangeMs), new Date(maxMs)];
}

// Target bucket count for server-aggregated facet series (see
// hooks/use-metric-aggregate-series.ts): enough resolution to read as a
// smooth line without asking DuckDB to return a bucket per raw point.
const TARGET_BUCKETS = 150;
const MIN_BUCKET_SECONDS = 1;

// bucketSecondsForRange picks a bucket width aiming for ~TARGET_BUCKETS
// buckets across a FIXED range, clamped so a bucket is never sub-second.
// Returns null for "all": there's no fixed window to divide client-side (the
// server defaults to its configured retention, not a value this client
// knows), and a fixed fallback window collapses a metric whose data spans
// much less than that window into a handful of giant buckets — the actual
// facet-view bucketing bug this type signature exists to prevent regressing
// on. null tells the server to auto-size against the real data extent
// instead (see storage.MetricAggregate's doc comment).
export function bucketSecondsForRange(range: ChartTimeRange): number | null {
  const rangeMs = rangeToMs(range);
  if (rangeMs === null) return null;
  return Math.max(MIN_BUCKET_SECONDS, Math.round(rangeMs / TARGET_BUCKETS / 1000));
}

export function filterPointsInDomain<T extends { time: Date }>(
  points: T[],
  domain: [Date, Date],
): T[] {
  const [start, end] = domain;
  const startMs = start.getTime();
  const endMs = end.getTime();
  return points.filter((p) => {
    const t = p.time.getTime();
    return t >= startMs && t <= endMs;
  });
}

// Trims a raw/aggregate row array to the same max-anchored window
// timeRangeDomain computes for the chart, but operating directly on
// timestamped rows (DataPoint / AggregatePointData) instead of the chart's
// {time: Date} shape — so callers computing range-scoped totals (stat tiles,
// the data points table) can filter without going through the chart's
// render pipeline. Uses Temporal, not Date.parse, per the project's
// OTel-timestamp convention (Date truncates the nanosecond precision OTel
// timestamps carry).
export function filterDataPointsInRange<T extends { timestamp: string }>(
  points: T[],
  range: ChartTimeRange,
): T[] {
  const rangeMs = rangeToMs(range);
  if (rangeMs === null || points.length === 0) return points;

  let maxMs = -Infinity;
  for (const p of points) {
    const ms = Temporal.Instant.from(p.timestamp).epochMilliseconds;
    if (ms > maxMs) maxMs = ms;
  }
  const minMs = maxMs - rangeMs;
  return points.filter((p) => Temporal.Instant.from(p.timestamp).epochMilliseconds >= minMs);
}
