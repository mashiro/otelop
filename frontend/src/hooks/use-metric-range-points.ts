import { useEffect, useMemo, useRef, useState } from "react";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { mergeDataPoints } from "@/stores/telemetry";
import { rangeToFrom, type ChartTimeRange } from "@/lib/chart-time-range";
import { useStableArray } from "@/hooks/use-stable-array";
import type { DataPoint, MetricData } from "@/types/telemetry";

const MetricPointsQuery = graphql(`
  query MetricPoints($serviceName: String!, $name: String!, $from: Time) {
    metricPoints(serviceName: $serviceName, name: $name, from: $from) {
      id
      timestamp
      value
      cumulative
      count
      countCumulative
      sum
      sumCumulative
      min
      max
      attributes
    }
  }
`);

// The DuckDB backend (docs/design/duckdb-storage.md) retains the full
// configured retention window (default 7d) server-side, but the client-side
// live buffer (stores/telemetry.ts DEFAULT_CONFIG) evicts old points once
// maxDataPoints is exceeded, to bound this tab's memory. Selecting a
// time-range backfills whatever the live buffer no longer holds with one
// server fetch (the metricPoints query — issue #162 — scoped server-side to
// just this (serviceName, name) group, unlike the metrics list's initial
// load); WebSocket deliveries (already flowing into `metric`'s dataPoints via
// addMetricAtom) keep layering on top without triggering a second fetch.
//
// Deliberately no snapshot/live branch: every CHART_TIME_RANGES option is
// defined relative to "now" (see chart-time-range.ts), and the render-time
// domain already anchors on the max *data* timestamp rather than the wall
// clock, so a metric that stopped producing data naturally renders as a
// static snapshot (nothing new to layer on top) while an actively live
// metric's domain keeps sliding forward as WS points arrive — no extra
// branching needed here.
export function useMetricRangePoints(metric: MetricData, range: ChartTimeRange): DataPoint[] {
  const [fetched, setFetched] = useState<DataPoint[]>([]);
  const { serviceName, name } = metric;
  // Tracks the metric identity the last fetch effect ran for, so a
  // range-only change can keep rendering the previous snapshot instead of
  // flashing down to the live buffer (the visible axis jump this hook exists
  // to avoid) while only a genuine metric switch clears it.
  const metricKeyRef = useRef(`${serviceName}::${name}`);

  useEffect(() => {
    let cancelled = false;
    const metricKey = `${serviceName}::${name}`;
    if (metricKeyRef.current !== metricKey) {
      setFetched([]);
    }
    metricKeyRef.current = metricKey;

    const from = rangeToFrom(range);

    const load = async () => {
      try {
        const data = await gqlClient.request(MetricPointsQuery, { serviceName, name, from });
        if (!cancelled) {
          setFetched(data.metricPoints);
        }
      } catch {
        // Fall back to whatever the live buffer already holds.
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
    // metric.dataPoints is intentionally excluded: refetch when the range or
    // selected metric changes, not on every WebSocket delivery.
  }, [range, serviceName, name]);

  const merged = useMemo(
    () => mergeDataPoints(fetched, metric.dataPoints),
    [fetched, metric.dataPoints],
  );
  // mergeDataPoints/setFetched both produce a fresh array identity on every
  // WS delivery even when a re-delivered (already-seen) point is the only
  // change; stabilizing here lets memoized consumers (MetricChart,
  // MetricSummary, DataPointsTable — driven off this hook's return value)
  // skip re-rendering when the window's actual content didn't move.
  return useStableArray(merged, (dp) => dp.id);
}
