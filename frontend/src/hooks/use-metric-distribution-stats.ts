import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { graphql } from "@/gql";
import { gqlClient } from "@/lib/graphql";
import { rangeToFrom } from "@/lib/chart-time-range";
import { eventWindowRange, type EventTimeWindow } from "@/lib/event-time-window";
import type { MetricData } from "@/types/telemetry";

const MetricDistributionStatsQuery = graphql(`
  query MetricDistributionStats(
    $serviceName: String!
    $name: String!
    $groupBy: [String!]
    $from: Time
    $to: Time
  ) {
    metricDistributionStats(
      serviceName: $serviceName
      name: $name
      groupBy: $groupBy
      from: $from
      to: $to
    ) {
      groupValues
      attributes
      count
      mean
      min
      max
      p50
      p90
      p95
      p99
    }
  }
`);

export interface MetricDistributionSeriesData {
  groupValues: string[];
  attributes: Record<string, unknown>;
  count: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
}

const LIVE_REFETCH_DEBOUNCE_MS = 2000;

export function useMetricDistributionStats(
  metric: MetricData,
  window: EventTimeWindow,
  groupBy: string[] | null,
): MetricDistributionSeriesData[] | null {
  const { serviceName, name, type, dataPoints } = metric;
  const supported = type === "Histogram" || type === "ExponentialHistogram";
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
  const groupByKey = JSON.stringify(groupBy);
  const scopeKey = `${serviceName}\u0000${name}\u0000${groupByKey}`;
  const [snapshot, setSnapshot] = useState<{
    scopeKey: string;
    series: MetricDistributionSeriesData[];
  } | null>(null);
  const requestIdRef = useRef(0);

  const fetchNow = useCallback(() => {
    if (!supported) return;
    const requestId = ++requestIdRef.current;
    void gqlClient
      .request(MetricDistributionStatsQuery, {
        serviceName,
        name,
        groupBy: groupBy ?? undefined,
        ...queryBounds,
      })
      .then((data) => {
        if (requestIdRef.current === requestId) {
          setSnapshot({ scopeKey, series: data.metricDistributionStats });
        }
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setSnapshot({ scopeKey, series: [] });
      });
    // groupBy's content is represented by groupByKey; callers memoize the
    // array, but keying the callback on content avoids accidental refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, serviceName, name, groupByKey, queryBounds, scopeKey]);

  useEffect(() => {
    if (!supported) {
      requestIdRef.current += 1;
      return;
    }
    fetchNow();
  }, [supported, fetchNow]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedDataPoints = useRef(dataPoints);
  useEffect(() => {
    if (mountedDataPoints.current === dataPoints) return;
    mountedDataPoints.current = dataPoints;
    if (!supported || windowMode !== "live") return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fetchNow, LIVE_REFETCH_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dataPoints, supported, windowMode, fetchNow]);

  // A range-only change keeps the current distribution visible until the
  // replacement request settles, matching the chart/range-point hooks. A
  // metric or breakdown change invalidates it immediately via scopeKey so
  // rows are never shown under the wrong labels.
  return snapshot?.scopeKey === scopeKey ? snapshot.series : null;
}
