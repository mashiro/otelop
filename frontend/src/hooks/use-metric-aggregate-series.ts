import { useCallback, useEffect, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { rangeToMs, bucketSecondsForRange, type ChartTimeRange } from "@/lib/chart-time-range";
import { useStableArray } from "@/hooks/use-stable-array";
import type { MetricFacet } from "@/lib/metric-catalog";
import type { MetricData } from "@/types/telemetry";

const MetricAggregateQuery = graphql(`
  query MetricAggregate(
    $serviceName: String!
    $name: String!
    $groupBy: [String!]!
    $bucketSeconds: Int
    $from: Time
  ) {
    metricAggregate(
      serviceName: $serviceName
      name: $name
      groupBy: $groupBy
      bucketSeconds: $bucketSeconds
      from: $from
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

// Shared reference so useStableArray's "both empty" comparison short-circuits
// to the same object instead of a fresh `[]` literal defeating its own
// reference check.
const EMPTY_SERIES: AggregateSeriesData[] = [];

// Cheap identity for a facet group's series: group membership plus its last
// bucket's timestamp/value. A debounced live refetch or a range/facet-value
// change often returns data that's identical to what's already rendered
// (e.g. no new bucket landed yet); comparing just the edges (not every
// bucket) is enough to catch that without walking every group's full point
// list on every fetch.
function seriesKey(s: AggregateSeriesData): string {
  const last = s.points.at(-1);
  return `${s.groupValues.join("\u0000")}|${s.points.length}|${last?.timestamp ?? ""}|${last?.value ?? ""}`;
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
  range: ChartTimeRange,
): AggregateSeriesData[] | null {
  const [series, setSeries] = useState<AggregateSeriesData[] | null>(null);
  const { serviceName, name, dataPoints } = metric;
  const groupBy = facet?.attributes ?? null;
  // facet is often a fresh object per render (resolved via useMemo upstream,
  // but still a new array identity across facet changes) — key on the
  // attribute list's content so effects don't refire every render.
  const groupByKey = groupBy?.join("\u0000") ?? null;
  const requestIdRef = useRef(0);
  // Tracks the metric identity the series currently on screen belongs to, so
  // a range or facet-value change (a different groupByKey, but still the
  // same metric) can keep rendering the previous series while the new fetch
  // is in flight, instead of blanking the chart until it lands.
  const metricKeyRef = useRef(`${serviceName}::${name}`);

  const fetchNow = useCallback(() => {
    if (!groupBy) return;
    const requestId = ++requestIdRef.current;
    const bucketSeconds = bucketSecondsForRange(range);
    const rangeMs = rangeToMs(range);
    const from =
      rangeMs === null
        ? undefined
        : Temporal.Now.instant().subtract({ milliseconds: rangeMs }).toString();

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
          from,
        });
        if (requestIdRef.current === requestId) {
          setSeries(data.metricAggregate);
        }
      } catch {
        if (requestIdRef.current === requestId) {
          setSeries(null);
        }
      }
    })();
    // groupBy's identity isn't stable across renders; groupByKey is the
    // real dependency (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceName, name, groupByKey, range]);

  // Immediate fetch on mount and whenever the metric/facet/range identity
  // changes — mirrors use-metric-range-points.ts's reset-then-fetch effect.
  // Only null the series out when there's nothing sensible left to show it
  // against: the facet was cleared (caller switches to the raw-points path)
  // or the selected metric itself changed. A range or facet-VALUE change
  // (still faceted, still the same metric) keeps the previous series on
  // screen — the requestId guard above already discards a stale response if
  // the user changes their selection again before it lands.
  useEffect(() => {
    const metricKey = `${serviceName}::${name}`;
    if (!groupByKey) {
      setSeries(null);
      metricKeyRef.current = metricKey;
      return;
    }
    if (metricKeyRef.current !== metricKey) {
      setSeries(null);
    }
    metricKeyRef.current = metricKey;
    fetchNow();
    // fetchNow already depends on every value that should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchNow, groupByKey, serviceName, name]);

  // Debounced refetch on live WS delivery for this metric. dataPoints is a
  // new array identity each time addMetricAtom merges in a WS message, so
  // its reference change is the live-update signal; the timer is cleared on
  // unmount/re-trigger per the project's useRef-timer convention.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedDataPoints = useRef(dataPoints);
  useEffect(() => {
    if (mountedDataPoints.current === dataPoints) return;
    mountedDataPoints.current = dataPoints;
    if (!groupByKey) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetchNow();
    }, LIVE_REFETCH_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dataPoints, groupByKey, fetchNow]);

  // A debounced live refetch or a range/facet-value change frequently comes
  // back byte-for-byte identical (no new bucket landed yet); stabilizing
  // here lets memoized consumers (MetricChart, MetricSummary) skip
  // re-rendering when it did.
  const stableSeries = useStableArray(series ?? EMPTY_SERIES, seriesKey);
  return series === null ? null : stableSeries;
}
