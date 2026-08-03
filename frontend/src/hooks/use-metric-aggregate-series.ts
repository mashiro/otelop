import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { rangeToFrom } from "@/lib/chart-time-range";
import {
  bucketSecondsForEventWindow,
  eventWindowKey,
  filterPointsInEventWindow,
  type EventTimeWindow,
} from "@/lib/event-time-window";
import type { MetricFacet } from "@/lib/metric-catalog";
import type { MetricData } from "@/types/telemetry";

const MetricAggregateQuery = graphql(`
  query MetricAggregate(
    $serviceName: String!
    $name: String!
    $groupBy: [String!]!
    $bucketSeconds: Int
    $from: Time
    $to: Time
  ) {
    metricAggregate(
      serviceName: $serviceName
      name: $name
      groupBy: $groupBy
      bucketSeconds: $bucketSeconds
      from: $from
      to: $to
    ) {
      groupValues
      points {
        timestamp
        value
        count
        sum
        min
        max
      }
    }
  }
`);

// Mirrors MetricAggregateQuery's generated shape exactly (fields present as
// `null`, never omitted) so gqlClient.request's real return type and test
// mocks/factories satisfy the same type without a bridging conversion.
export interface AggregatePointData {
  timestamp: string;
  value: number;
  count: number | null;
  sum: number | null;
  min: number | null;
  max: number | null;
}

export interface AggregateSeriesData {
  groupValues: string[];
  points: AggregatePointData[];
}

// How long to wait after a live WS delivery before refetching the
// server-aggregated series. Aggregation happens in DuckDB, not in this tab,
// so a live point can't be merged into a bucket client-side (see the task
// this hook implements) — the only option is to re-ask the server, and a
// trailing debounce keeps a bursty metric from re-querying on every message.
const LIVE_REFETCH_DEBOUNCE_MS = 2000;

// Include every bucket field: a delayed point can revise an earlier bucket
// without changing the series length or last point. Aggregate responses top
// out around 150 buckets, so this correctness check stays bounded.
function seriesKey(s: AggregateSeriesData): string {
  return `${s.groupValues.join("\u0000")}|${s.points
    .map((p) => [p.timestamp, p.value, p.count, p.sum, p.min, p.max].join("\u0001"))
    .join("\u0002")}`;
}

// useMetricAggregateSeries fetches server-side facet aggregation (see
// internal/storage's MetricAggregate / the metricAggregate GraphQL query) —
// the fix for the chart's facet view concatenating raw points from multiple
// underlying attribute-series into a zigzag instead of summing them. Modeled
// on use-metric-range-points.ts's fetch/cancel shape, but with no client-side
// merge step: aggregation must happen server-side over the full window, so a
// live WS delivery triggers a debounced refetch instead of being layered in.
//
// Returns null when facet is null (caller should render the raw-points path
// instead) or while no successful fetch has landed yet/the last fetch failed.
export function useMetricAggregateSeries(
  metric: MetricData,
  facet: MetricFacet | null,
  window: EventTimeWindow,
): AggregateSeriesData[] | null {
  const { serviceName, name, dataPoints } = metric;
  const metricKey = `${serviceName}::${name}`;
  const [snapshot, setSnapshot] = useState<{
    queryKey: string;
    series: AggregateSeriesData[];
  } | null>(null);
  const groupBy = facet?.attributes ?? null;
  // facet is often a fresh object per render (resolved via useMemo upstream,
  // but still a new array identity across facet changes) — key on the
  // attribute list's content so effects don't refire every render.
  const groupByKey = groupBy?.join("\u0000") ?? null;
  const requestIdRef = useRef(0);
  const windowMode = window.mode;
  const liveRange = window.mode === "live" ? window.range : undefined;
  const fixedFrom = window.mode === "fixed" ? window.from : undefined;
  const fixedTo = window.mode === "fixed" ? window.to : undefined;
  const queryBounds = useMemo(
    () => ({
      from: windowMode === "fixed" ? fixedFrom : liveRange ? rangeToFrom(liveRange) : undefined,
      to: fixedTo,
    }),
    [windowMode, fixedFrom, fixedTo, liveRange],
  );
  const bucketSeconds = bucketSecondsForEventWindow(window);
  const queryKey = `${metricKey}|${groupByKey ?? ""}|${eventWindowKey(window)}|${bucketSeconds ?? "auto"}`;

  const fetchNow = useCallback(() => {
    if (!groupBy) return;
    const requestId = ++requestIdRef.current;
    void (async () => {
      try {
        const data = await gqlClient.request(MetricAggregateQuery, {
          serviceName,
          name,
          groupBy,
          // Omitted (not just null) for "all" so the server's auto-bucketing
          // sentinel applies (see chart-time-range.ts's bucketSecondsForRange
          // and storage.MetricAggregate's doc comment) rather than sending an
          // explicit null that happens to behave the same today but couples
          // this call site to that coincidence.
          ...(bucketSeconds !== null ? { bucketSeconds } : {}),
          ...queryBounds,
        });
        if (requestIdRef.current === requestId) {
          setSnapshot({ queryKey, series: data.metricAggregate });
        }
      } catch {
        if (requestIdRef.current === requestId) {
          setSnapshot(null);
        }
      }
    })();
    // groupBy's identity isn't stable across renders; groupByKey is the
    // real dependency (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceName, name, queryKey, groupByKey, bucketSeconds, queryBounds]);

  // Immediate fetch on mount and whenever the metric/facet/range identity
  // changes. The query-scoped snapshot below prevents a previous window or
  // facet from being rendered under the newly selected controls.
  useEffect(() => {
    if (!groupByKey) {
      requestIdRef.current += 1;
      return;
    }
    fetchNow();
  }, [fetchNow, groupByKey]);

  // Debounced refetch on a relevant WS delivery for this metric. dataPoints is a
  // new array identity each time addMetricAtom merges in a WS message, so
  // its reference change is the live-update signal; the timer is cleared on
  // unmount/re-trigger per the project's useRef-timer convention.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedDataPoints = useRef(dataPoints);
  useEffect(() => {
    if (mountedDataPoints.current === dataPoints) return;
    const previous = mountedDataPoints.current;
    mountedDataPoints.current = dataPoints;
    if (!groupByKey) return;

    // A fixed historical view should not poll on unrelated current traffic,
    // but a late-arriving point inside that exact window must invalidate its
    // server aggregate. GraphQL and this predicate both use [from, to).
    if (windowMode === "fixed") {
      const previousIds = new Set(previous.map((point) => point.id));
      const added = dataPoints.filter((point) => !previousIds.has(point.id));
      if (filterPointsInEventWindow(added, window, (point) => point.epochNs).length === 0) return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetchNow();
    }, LIVE_REFETCH_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dataPoints, groupByKey, fetchNow, window, windowMode]);

  // A debounced live refetch or a range/facet-value change frequently comes
  // back byte-for-byte identical (no new bucket landed yet); stabilizing
  // here lets memoized consumers (MetricChart, MetricSummary) skip
  // re-rendering when it did.
  const series = snapshot?.queryKey === queryKey ? snapshot.series : null;
  const stableSeriesRef = useRef<{ key: string; series: AggregateSeriesData[] } | null>(null);
  if (series) {
    // Compare every facet group, not only the response array's first/last
    // element: a late point can revise any middle group in place.
    const responseKey = `${queryKey}|${series.map(seriesKey).join("\u0003")}`;
    if (stableSeriesRef.current?.key !== responseKey) {
      stableSeriesRef.current = { key: responseKey, series };
    }
  }
  return groupByKey && series ? stableSeriesRef.current!.series : null;
}
