import { Temporal } from "temporal-polyfill";

export type ChartTimeRange = "1m" | "5m" | "15m" | "30m" | "1h" | "6h" | "24h" | "all";

// No 7d option: the default retention window is 7d, so a 7d range would just
// duplicate "all" instead of offering a genuinely narrower/wider choice.
export const CHART_TIME_RANGES: { value: ChartTimeRange; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "all", label: "All" },
];

const RANGE_MINUTES: Record<Exclude<ChartTimeRange, "all">, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "6h": 6 * 60,
  "24h": 24 * 60,
};

// The metric detail view's default window (frontend defaults to a recent
// window; DuckDB history is fetched on demand). Also the value elided from
// the `range` URL query param, so a detail view left at the default keeps a
// clean URL — see buildPath/parsePath in stores/navigation.ts.
export const DEFAULT_CHART_TIME_RANGE: ChartTimeRange = "1h";

export function isChartTimeRange(value: string): value is ChartTimeRange {
  return CHART_TIME_RANGES.some((r) => r.value === value);
}

export function rangeToMs(range: ChartTimeRange): number | null {
  if (range === "all") return null;
  return RANGE_MINUTES[range] * 60_000;
}

// Converts a range selection into the GraphQL `from` argument every
// range-scoped fetch sends (hooks/use-signal-list-page.ts,
// use-metric-range-points.ts, use-metric-aggregate-series.ts): "all" has no
// fixed lower bound, so it's elided
// (undefined) rather than sent as an explicit null, letting the server apply
// its own default; every other range subtracts from "now" via Temporal (not
// Date.parse) per the project's OTel-timestamp convention.
export function rangeToFrom(range: ChartTimeRange): string | undefined {
  const rangeMs = rangeToMs(range);
  return rangeMs === null
    ? undefined
    : Temporal.Now.instant().subtract({ milliseconds: rangeMs }).toString();
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
// Mirrors internal/storage/query_metric_aggregate.go's
// metricAggregateTargetBuckets constant — both encode the same UX policy
// (how many buckets a chart should aim for), just for two different
// call sites (this picks a bucket width for a FIXED range client-side; the
// Go constant auto-sizes buckets against the real data extent server-side
// for "all"), so keep them in sync by hand if the target ever changes.
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
//
// getTimestamp defaults to reading `.timestamp` (DataPoint/AggregatePoint's
// shape); trace rows carry their instant under `startTime` instead, so the
// trace/log list's live-tail display filter (components/traces/trace-list.tsx,
// components/logs/log-list.tsx) passes an explicit selector rather than
// reshaping every row just to satisfy this function's default field name.
export function filterDataPointsInRange<T extends { timestamp: string }>(
  points: T[],
  range: ChartTimeRange,
): T[];
export function filterDataPointsInRange<T>(
  points: T[],
  range: ChartTimeRange,
  getTimestamp: (point: T) => string,
): T[];
export function filterDataPointsInRange<T>(
  points: T[],
  range: ChartTimeRange,
  getTimestamp: (point: T) => string = (p) => (p as { timestamp: string }).timestamp,
): T[] {
  const rangeMs = rangeToMs(range);
  if (rangeMs === null || points.length === 0) return points;

  // Single pass: parse each point's timestamp exactly once, caching the
  // epoch value alongside it while tracking the max, then filter against the
  // cached values instead of re-parsing every point a second time. Called on
  // every WS message via stores/filters.ts's rangeFilteredTracesAtom/
  // rangeFilteredLogsAtom over the full capped buffer, so halving the
  // Temporal.Instant.from calls matters here.
  let maxMs = -Infinity;
  const withMs: { point: T; ms: number }[] = [];
  for (const point of points) {
    const ms = Temporal.Instant.from(getTimestamp(point)).epochMilliseconds;
    withMs.push({ point, ms });
    if (ms > maxMs) maxMs = ms;
  }
  const minMs = maxMs - rangeMs;
  const result: T[] = [];
  for (const { point, ms } of withMs) {
    if (ms >= minMs) result.push(point);
  }
  return result;
}
