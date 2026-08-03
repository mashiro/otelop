import type { DataPoint } from "@/types/telemetry";
import type { EventTimeWindow } from "@/lib/event-time-window";
import { bucketSecondsForEventWindow } from "@/lib/event-time-window";
import { bucketSecondsForDataExtent } from "@/lib/chart-time-range";

export interface MetricChartPoint {
  time: Date;
  value: number;
}

export function bucketSecondsForRawMetricPoints(
  points: DataPoint[],
  window: EventTimeWindow,
): number {
  return (
    bucketSecondsForEventWindow(window) ??
    bucketSecondsForDataExtent(points.map((point) => point.epochNs))
  );
}

interface Bucket {
  epochNs: bigint;
  valueSum: number;
  sampleCount: number;
  distributionCount: number;
  distributionSum: number;
}

function bucketStart(epochNs: bigint, widthNs: bigint): bigint {
  // OTel data is ordinarily post-epoch, but keep mathematical floor
  // semantics for pre-1970 timestamps too.
  const quotient = epochNs / widthNs;
  return epochNs < 0n && epochNs % widthNs !== 0n ? (quotient - 1n) * widthNs : quotient * widthNs;
}

/**
 * Bucket one raw attribute-series with the same scalar semantics as
 * storage.MetricAggregate: Sum deltas add, Gauge samples average, and
 * distributions use their count-weighted mean.
 */
export function bucketRawMetricPoints(
  points: DataPoint[],
  metricType: string,
  window: EventTimeWindow,
  seconds = bucketSecondsForRawMetricPoints(points, window),
): MetricChartPoint[] {
  if (points.length === 0) return [];
  const widthNs = BigInt(seconds) * 1_000_000_000n;
  const buckets = new Map<bigint, Map<string, Bucket>>();

  for (const point of points) {
    const epochNs = bucketStart(point.epochNs, widthNs);
    let seriesBuckets = buckets.get(epochNs);
    if (!seriesBuckets) {
      seriesBuckets = new Map();
      buckets.set(epochNs, seriesBuckets);
    }
    let bucket = seriesBuckets.get(point.seriesKey);
    if (!bucket) {
      bucket = {
        epochNs,
        valueSum: 0,
        sampleCount: 0,
        distributionCount: 0,
        distributionSum: 0,
      };
      seriesBuckets.set(point.seriesKey, bucket);
    }
    bucket.valueSum += point.value;
    bucket.sampleCount += 1;
    if (point.count != null && point.sum != null) {
      bucket.distributionCount += point.count;
      bucket.distributionSum += point.sum;
    }
  }

  const fixedFromMs = window.mode === "fixed" ? new Date(window.from).getTime() : null;
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([epochNs, seriesBuckets]) => {
      const contributors = [...seriesBuckets.values()];
      let value: number;
      if (metricType === "Gauge") {
        // Match storage.MetricAggregate: average each independent OTel
        // series first, then sum those series within the displayed group.
        value = contributors.reduce((sum, bucket) => sum + bucket.valueSum / bucket.sampleCount, 0);
      } else {
        const distributionCount = contributors.reduce(
          (sum, bucket) => sum + bucket.distributionCount,
          0,
        );
        value =
          distributionCount > 0
            ? contributors.reduce((sum, bucket) => sum + bucket.distributionSum, 0) /
              distributionCount
            : contributors.reduce((sum, bucket) => sum + bucket.valueSum, 0);
      }
      const bucketMs = Number(epochNs / 1_000_000n);
      return {
        // A fixed query may return a partial first bucket whose epoch-aligned
        // start precedes `from`. Plot it at the visible left boundary rather
        // than filtering away in-window data.
        time: new Date(fixedFromMs === null ? bucketMs : Math.max(bucketMs, fixedFromMs)),
        value,
      };
    });
}

export function chartTimeForAggregateTimestamp(timestamp: string, window: EventTimeWindow): Date {
  const bucketMs = new Date(timestamp).getTime();
  if (window.mode === "live") return new Date(bucketMs);
  return new Date(Math.max(bucketMs, new Date(window.from).getTime()));
}
