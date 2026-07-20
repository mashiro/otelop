import { useEffect, useMemo, useState } from "react";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { mergeDataPoints } from "@/stores/telemetry";
import { rangeToFrom } from "@/lib/chart-time-range";
import {
  eventWindowRange,
  filterPointsInEventWindow,
  type EventTimeWindow,
} from "@/lib/event-time-window";
import { useStableArray } from "@/hooks/use-stable-array";
import { normalizeDataPoint } from "@/lib/normalize";
import type { DataPoint, MetricData } from "@/types/telemetry";

const MetricPointsQuery = graphql(`
  query MetricPoints($serviceName: String!, $name: String!, $from: Time, $to: Time) {
    metricPoints(serviceName: $serviceName, name: $name, from: $from, to: $to) {
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
// Live windows fetch from their relative lower bound and merge WS points;
// fixed windows send both bounds and filter the merged live buffer to the
// same interval. That keeps the tiles, chart, and table on one exact scope
// while retaining the existing max-data anchoring for a stopped live metric.
export function useMetricRangePoints(metric: MetricData, window: EventTimeWindow): DataPoint[] {
  const { serviceName, name } = metric;
  const metricKey = `${serviceName}::${name}`;
  const range = eventWindowRange(window) ?? "1h";
  const windowMode = window.mode;
  const fixedFrom = window.mode === "fixed" ? window.from : undefined;
  const fixedTo = window.mode === "fixed" ? window.to : undefined;
  const queryBounds = useMemo(
    () => ({
      from: windowMode === "fixed" ? fixedFrom : rangeToFrom(range),
      to: fixedTo,
    }),
    [windowMode, fixedFrom, fixedTo, range],
  );
  const [snapshot, setSnapshot] = useState<{ metricKey: string; points: DataPoint[] } | null>(null);
  // A range-only change keeps the previous snapshot visible while the next
  // request is in flight. A metric change invalidates it immediately by key,
  // without a state-reset effect and its extra render.
  const fetched = snapshot?.metricKey === metricKey ? snapshot.points : [];

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await gqlClient.request(MetricPointsQuery, {
          serviceName,
          name,
          ...queryBounds,
        });
        if (!cancelled) {
          setSnapshot({ metricKey, points: data.metricPoints.map(normalizeDataPoint) });
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
  }, [queryBounds, serviceName, name, metricKey]);

  const merged = useMemo(
    () => mergeDataPoints(fetched, metric.dataPoints),
    [fetched, metric.dataPoints],
  );
  // mergeDataPoints/setFetched both produce a fresh array identity on every
  // WS delivery even when a re-delivered (already-seen) point is the only
  // change; stabilizing here lets memoized consumers (MetricChart,
  // MetricSummary, DataPointsTable — driven off this hook's return value)
  // skip re-rendering when the window's actual content didn't move.
  const windowed = useMemo(
    () => filterPointsInEventWindow(merged, window, (dp) => dp.epochNs),
    [merged, window],
  );
  return useStableArray(windowed, (dp) => dp.id);
}
