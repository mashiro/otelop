import { useEffect, useMemo, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { mergeDataPoints } from "@/stores/telemetry";
import { rangeToMs, type ChartTimeRange } from "@/lib/chart-time-range";
import { useStableArray } from "@/hooks/use-stable-array";
import type { DataPoint, MetricData } from "@/types/telemetry";

const MetricRangeQuery = graphql(`
  query MetricRange($from: Time) {
    metrics(limit: 0, from: $from) {
      items {
        serviceName
        name
        dataPoints {
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
    }
  }
`);

// The DuckDB backend (docs/design/duckdb-storage.md) retains the full
// configured retention window (default 7d) server-side, but the client-side
// live buffer (stores/telemetry.ts DEFAULT_CONFIG) evicts old points once
// maxDataPoints is exceeded, to bound this tab's memory. Selecting a
// time-range backfills whatever the live buffer no longer holds with one
// server fetch; WebSocket deliveries (already flowing into `metric`'s
// dataPoints via addMetricAtom) keep layering on top without triggering a
// second fetch.
//
// There's no dedicated "one metric's points" query (see schema.graphql) —
// `metrics` always returns every (service, name) group in the window — so
// this fetches the whole page (limit: 0, mirroring useInitialLoad) and picks
// out the matching group client-side. Deliberately no snapshot/live branch:
// every CHART_TIME_RANGES option is defined relative to "now" (see
// chart-time-range.ts), and the render-time domain already anchors on the
// max *data* timestamp rather than the wall clock, so a metric that stopped
// producing data naturally renders as a static snapshot (nothing new to
// layer on top) while an actively live metric's domain keeps sliding forward
// as WS points arrive — no extra branching needed here.
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

    const rangeMs = rangeToMs(range);
    const from =
      rangeMs === null
        ? undefined
        : Temporal.Now.instant().subtract({ milliseconds: rangeMs }).toString();

    const load = async () => {
      try {
        const data = await gqlClient.request(MetricRangeQuery, { from });
        const match = data.metrics.items.find(
          (m) => m.serviceName === serviceName && m.name === name,
        );
        if (!cancelled && match) {
          setFetched(match.dataPoints);
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
