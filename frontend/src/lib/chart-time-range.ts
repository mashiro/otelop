import { Temporal } from "temporal-polyfill";

export type ChartTimeRange =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "3h"
  | "6h"
  | "12h"
  | "24h"
  | "all";

// No 7d option: the default retention window is 7d, so a 7d range would just
// duplicate "all" instead of offering a genuinely narrower/wider choice.
export const CHART_TIME_RANGES: { value: ChartTimeRange; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "3h", label: "3h" },
  { value: "6h", label: "6h" },
  { value: "12h", label: "12h" },
  { value: "24h", label: "24h" },
  { value: "all", label: "All" },
];

const RANGE_MINUTES: Record<Exclude<ChartTimeRange, "all">, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "3h": 3 * 60,
  "6h": 6 * 60,
  "12h": 12 * 60,
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
  return bucketSecondsForDurationMs(rangeMs);
}

export function bucketSecondsForDurationMs(durationMs: number): number {
  return Math.max(MIN_BUCKET_SECONDS, Math.round(durationMs / TARGET_BUCKETS / 1000));
}

// Mirrors storage.metricAggregateAutoBucket for the raw "All" chart path:
// auto-size against the points' real extent, not an arbitrary retention
// window. The server passes a whole-second width to DuckDB, so truncate the
// candidate here as well.
export function bucketSecondsForDataExtent(epochNs: bigint[]): number {
  if (epochNs.length < 2) return MIN_BUCKET_SECONDS;
  let min = epochNs[0]!;
  let max = min;
  for (const ns of epochNs.slice(1)) {
    if (ns < min) min = ns;
    if (ns > max) max = ns;
  }
  const seconds = Number((max - min) / 1_000_000_000n) / TARGET_BUCKETS;
  return Math.max(MIN_BUCKET_SECONDS, Math.floor(seconds));
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
// render pipeline.
//
// getEpochNs is mandatory (no default field-name guess): every store view
// model (TraceData/LogData/DataPoint — see types/telemetry.ts) already
// carries a pre-parsed epoch-ns field via lib/normalize.ts, so callers pass a
// trivial field accessor instead of a timestamp string this function would
// have to re-parse. A caller with no such field (e.g. the ephemeral
// AggregatePointData from a server-aggregated fetch) parses via
// lib/normalize.ts's parseEpochNs at the call site instead — still the
// single Temporal.Instant.from call site, just invoked explicitly rather
// than implicitly by this function.
export function filterDataPointsInRange<T>(
  points: T[],
  range: ChartTimeRange,
  getEpochNs: (point: T) => bigint,
): T[] {
  const rangeMs = rangeToMs(range);
  if (rangeMs === null || points.length === 0) return points;
  const rangeNs = BigInt(rangeMs) * 1_000_000n;

  // Single pass: read each point's epoch exactly once, caching it alongside
  // the point while tracking the max, then filter against the cached values
  // instead of reading every point a second time. Called on every WS message
  // via stores/filters.ts's rangeFilteredTracesAtom/rangeFilteredLogsAtom
  // over the full capped buffer.
  const withNs: { point: T; ns: bigint }[] = [];
  let maxNs: bigint | undefined;
  for (const point of points) {
    const ns = getEpochNs(point);
    withNs.push({ point, ns });
    if (maxNs === undefined || ns > maxNs) maxNs = ns;
  }
  // maxNs is always set here: the empty-input case already returned above.
  const minNs = maxNs! - rangeNs;
  const result: T[] = [];
  for (const { point, ns } of withNs) {
    if (ns >= minNs) result.push(point);
  }
  return result;
}
