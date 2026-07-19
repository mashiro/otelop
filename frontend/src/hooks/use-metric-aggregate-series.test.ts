import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { useMetricAggregateSeries } from "./use-metric-aggregate-series";
import { makeMetric, makeDataPoint, makeAggregateSeries } from "@/test/factories";
import type { MetricAggregateQuery, MetricAggregateQueryVariables } from "@/gql/graphql";
import type { MetricFacet } from "@/lib/metric-catalog";
import type { ChartTimeRange } from "@/lib/chart-time-range";

function liveWindow(range: ChartTimeRange) {
  return { mode: "live" as const, range };
}

const REGION_FACET: MetricFacet = { attributes: ["region"], label: "Region" };

const { requestMock } = vi.hoisted(() => ({
  requestMock:
    vi.fn<(doc: unknown, vars: MetricAggregateQueryVariables) => Promise<MetricAggregateQuery>>(),
}));

vi.mock("@/lib/graphql", () => ({
  gqlClient: { request: requestMock },
}));

beforeEach(() => {
  requestMock.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useMetricAggregateSeries", () => {
  it("does not fetch when facet is null", () => {
    const metric = makeMetric({ dataPoints: [makeDataPoint({ id: "a" })] });

    const { result } = renderHook(() => useMetricAggregateSeries(metric, null, liveWindow("all")));

    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("fetches metricAggregate with groupBy derived from the facet, omitting bucketSeconds for 'all'", async () => {
    requestMock.mockResolvedValue({ metricAggregate: [] });
    const metric = makeMetric({ serviceName: "svc", name: "http.requests" });

    renderHook(() => useMetricAggregateSeries(metric, REGION_FACET, liveWindow("all")));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const vars = requestMock.mock.calls[0]?.[1];
    expect(vars).toMatchObject({
      serviceName: "svc",
      name: "http.requests",
      groupBy: ["region"],
      from: undefined,
      to: undefined,
    });
    // Omitted entirely (not sent as null) so the server auto-sizes the
    // bucket against the metric's real data extent — see
    // chart-time-range.ts's bucketSecondsForRange.
    expect(vars).not.toHaveProperty("bucketSeconds");
  });

  it("computes a wall-clock `from` bound and includes a positive bucketSeconds for a fixed range", async () => {
    requestMock.mockResolvedValue({ metricAggregate: [] });
    const metric = makeMetric();

    renderHook(() => useMetricAggregateSeries(metric, REGION_FACET, liveWindow("1h")));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const vars = requestMock.mock.calls[0]?.[1];
    expect(vars?.from).toBeTruthy();
    expect(vars?.bucketSeconds).toBeGreaterThan(0);
  });

  it("passes both bounds for a shifted window", async () => {
    requestMock.mockResolvedValue({ metricAggregate: [] });
    const metric = makeMetric();
    const window = {
      mode: "fixed" as const,
      from: "2026-07-12T01:00:00Z",
      to: "2026-07-12T02:00:00Z",
    };

    renderHook(() => useMetricAggregateSeries(metric, REGION_FACET, window));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0]?.[1]).toMatchObject({
      from: window.from,
      to: window.to,
      bucketSeconds: 24,
    });
  });

  it("returns the fetched aggregate series", async () => {
    const series = [makeAggregateSeries({ groupValues: ["us-east"] })];
    requestMock.mockResolvedValue({ metricAggregate: series });
    const metric = makeMetric();

    const { result } = renderHook(() =>
      useMetricAggregateSeries(metric, REGION_FACET, liveWindow("all")),
    );

    await waitFor(() => expect(result.current).toEqual(series));
  });

  it("refetches when the facet changes", async () => {
    requestMock.mockResolvedValue({ metricAggregate: [] });
    const metric = makeMetric();

    const { rerender } = renderHook(
      ({ facet }: { facet: MetricFacet }) =>
        useMetricAggregateSeries(metric, facet, liveWindow("all")),
      { initialProps: { facet: REGION_FACET } },
    );

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    rerender({ facet: { attributes: ["worker"], label: "Worker" } });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1]?.[1]).toMatchObject({ groupBy: ["worker"] });
  });

  it("does not refetch when only metric.dataPoints changes but the object identity is unchanged", async () => {
    requestMock.mockResolvedValue({ metricAggregate: [] });
    const metric = makeMetric({ dataPoints: [makeDataPoint({ id: "a" })] });

    const { rerender } = renderHook(
      ({ m }: { m: typeof metric }) => useMetricAggregateSeries(m, REGION_FACET, liveWindow("all")),
      { initialProps: { m: metric } },
    );
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    // Re-render with the exact same metric object: must not refetch.
    rerender({ m: metric });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("debounces a refetch (>=2s trailing) when a new WS delivery changes metric.dataPoints", async () => {
    requestMock.mockResolvedValue({ metricAggregate: [] });
    const metric = makeMetric({ dataPoints: [makeDataPoint({ id: "a" })] });

    const { rerender } = renderHook(
      ({ m }: { m: typeof metric }) => useMetricAggregateSeries(m, REGION_FACET, liveWindow("all")),
      { initialProps: { m: metric } },
    );
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    // A new WS-delivered point arrives: a new metric object/dataPoints array.
    const updated = { ...metric, dataPoints: [...metric.dataPoints, makeDataPoint({ id: "b" })] };
    rerender({ m: updated });

    // Not immediate.
    expect(requestMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(requestMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("does not refetch a fixed historical window when live points arrive", async () => {
    requestMock.mockResolvedValue({ metricAggregate: [] });
    const metric = makeMetric({ dataPoints: [makeDataPoint({ id: "a" })] });
    const window = {
      mode: "fixed" as const,
      from: "2026-07-12T01:00:00Z",
      to: "2026-07-12T02:00:00Z",
    };
    const { rerender } = renderHook(
      ({ m }: { m: typeof metric }) => useMetricAggregateSeries(m, REGION_FACET, window),
      { initialProps: { m: metric } },
    );
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    rerender({
      m: { ...metric, dataPoints: [...metric.dataPoints, makeDataPoint({ id: "b" })] },
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("clears the debounce timer on unmount (no refetch after unmount)", async () => {
    requestMock.mockResolvedValue({ metricAggregate: [] });
    const metric = makeMetric({ dataPoints: [makeDataPoint({ id: "a" })] });

    const { rerender, unmount } = renderHook(
      ({ m }: { m: typeof metric }) => useMetricAggregateSeries(m, REGION_FACET, liveWindow("all")),
      { initialProps: { m: metric } },
    );
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    const updated = { ...metric, dataPoints: [...metric.dataPoints, makeDataPoint({ id: "b" })] };
    rerender({ m: updated });
    unmount();

    await vi.advanceTimersByTimeAsync(5000);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("returns null again once the facet is cleared", async () => {
    requestMock.mockResolvedValue({ metricAggregate: [makeAggregateSeries()] });
    const metric = makeMetric();

    const { result, rerender } = renderHook(
      ({ facet }: { facet: MetricFacet | null }) =>
        useMetricAggregateSeries(metric, facet, liveWindow("all")),
      { initialProps: { facet: REGION_FACET as MetricFacet | null } },
    );
    await waitFor(() => expect(result.current).not.toBeNull());

    rerender({ facet: null });
    expect(result.current).toBeNull();
  });

  it("keeps rendering the previous series during a range-change refetch (no intermediate null emission)", async () => {
    const series = [makeAggregateSeries({ groupValues: ["us-east"] })];
    requestMock.mockResolvedValueOnce({ metricAggregate: series });
    const metric = makeMetric();

    const { result, rerender } = renderHook(
      ({ range }: { range: "1h" | "5m" }) =>
        useMetricAggregateSeries(metric, REGION_FACET, liveWindow(range)),
      { initialProps: { range: "1h" } },
    );

    await waitFor(() => expect(result.current).toEqual(series));

    let resolveSecond: (value: MetricAggregateQuery) => void = () => {};
    const pending = new Promise<MetricAggregateQuery>((resolve) => {
      resolveSecond = resolve;
    });
    requestMock.mockImplementationOnce(() => pending);

    rerender({ range: "5m" });

    // Still showing the previous series while the range-change fetch is in
    // flight — not blanked to null.
    expect(result.current).toEqual(series);

    resolveSecond({ metricAggregate: [] });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("keeps rendering the previous series across a facet-value change (still faceted, same metric)", async () => {
    const series = [makeAggregateSeries({ groupValues: ["us-east"] })];
    requestMock.mockResolvedValueOnce({ metricAggregate: series });
    const metric = makeMetric();

    const { result, rerender } = renderHook(
      ({ facet }: { facet: MetricFacet }) =>
        useMetricAggregateSeries(metric, facet, liveWindow("all")),
      { initialProps: { facet: REGION_FACET } },
    );
    await waitFor(() => expect(result.current).toEqual(series));

    let resolveSecond: (value: MetricAggregateQuery) => void = () => {};
    const pending = new Promise<MetricAggregateQuery>((resolve) => {
      resolveSecond = resolve;
    });
    requestMock.mockImplementationOnce(() => pending);

    rerender({ facet: { attributes: ["worker"], label: "Worker" } });

    expect(result.current).toEqual(series);

    resolveSecond({ metricAggregate: [] });
    await waitFor(() => expect(result.current).toEqual([]));
  });
});
