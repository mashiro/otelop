import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { Temporal } from "temporal-polyfill";
import { useMetricRangePoints } from "./use-metric-range-points";
import { makeMetric, makeDataPoint } from "@/test/factories";
import type { MetricPointsQuery, MetricPointsQueryVariables } from "@/gql/graphql";
import type { DataPoint, MetricData } from "@/types/telemetry";
import type { ChartTimeRange } from "@/lib/chart-time-range";

function liveWindow(range: ChartTimeRange) {
  return { mode: "live" as const, range };
}

// MetricPointsQuery's generated type requires the nullable distribution
// fields to be present (as `null`, not simply omitted) — unlike DataPoint,
// where they're optional. Bridges a factory-made DataPoint into that shape.
function toQueryPoint(dp: DataPoint) {
  return {
    id: dp.id,
    seriesKey: dp.seriesKey,
    timestamp: dp.timestamp,
    value: dp.value,
    cumulative: dp.cumulative ?? null,
    count: dp.count ?? null,
    countCumulative: dp.countCumulative ?? null,
    sum: dp.sum ?? null,
    sumCumulative: dp.sumCumulative ?? null,
    min: dp.min ?? null,
    max: dp.max ?? null,
    attributes: dp.attributes,
  };
}

// A standalone mock fn (not `gqlClient.request` accessed as a member) avoids
// typescript-eslint's unbound-method warning, and an explicit signature keeps
// `.mock.calls[0][1]` typed instead of falling back to the client's
// single-argument overload.
const { requestMock } = vi.hoisted(() => ({
  requestMock:
    vi.fn<(doc: unknown, vars: MetricPointsQueryVariables) => Promise<MetricPointsQuery>>(),
}));

vi.mock("@/lib/graphql", () => ({
  gqlClient: { request: requestMock },
}));

beforeEach(() => {
  requestMock.mockReset();
});

describe("useMetricRangePoints", () => {
  it("passes serviceName/name and omits `from` for the all range (fetches the full retention window)", async () => {
    requestMock.mockResolvedValue({ metricPoints: [] });
    const metric = makeMetric({
      serviceName: "frontend",
      name: "http.requests",
      dataPoints: [makeDataPoint({ id: "a" })],
    });

    renderHook(() => useMetricRangePoints(metric, liveWindow("all")));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0]?.[1]).toEqual({
      serviceName: "frontend",
      name: "http.requests",
      from: undefined,
      to: undefined,
    });
  });

  it("computes a wall-clock `from` bound for a fixed range", async () => {
    requestMock.mockResolvedValue({ metricPoints: [] });
    const metric = makeMetric({ dataPoints: [makeDataPoint({ id: "a" })] });
    const before = Temporal.Now.instant();

    renderHook(() => useMetricRangePoints(metric, liveWindow("5m")));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const from = requestMock.mock.calls[0]?.[1]?.from;
    const fromInstant = Temporal.Instant.from(from!);
    // from should be ~5 minutes before "now" at call time, not before the test start.
    const deltaMs = before.since(fromInstant).total("milliseconds");
    expect(deltaMs).toBeGreaterThan(4.9 * 60_000);
    expect(deltaMs).toBeLessThan(5.1 * 60_000);
  });

  it("queries and renders only the explicit bounds of a shifted window", async () => {
    const inside = makeDataPoint({ id: "inside", timestamp: "2026-07-12T01:30:00Z" });
    requestMock.mockResolvedValue({ metricPoints: [toQueryPoint(inside)] });
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "outside", timestamp: "2026-07-12T02:30:00Z" })],
    });
    const window = {
      mode: "fixed" as const,
      from: "2026-07-12T01:00:00Z",
      to: "2026-07-12T02:00:00Z",
    };

    const { result } = renderHook(() => useMetricRangePoints(metric, window));

    await waitFor(() => expect(result.current.map((point) => point.id)).toEqual(["inside"]));
    expect(requestMock.mock.calls[0]?.[1]).toMatchObject({
      from: window.from,
      to: window.to,
    });
  });

  it("merges the server-fetched snapshot with the live metric.dataPoints by id", async () => {
    const serverOnly = makeDataPoint({ id: "server-only", timestamp: "2024-01-01T00:00:00Z" });
    requestMock.mockResolvedValue({ metricPoints: [toQueryPoint(serverOnly)] });
    const liveOnly = makeDataPoint({ id: "live-only", timestamp: "2024-01-01T00:01:00Z" });
    const metric = makeMetric({
      serviceName: "frontend",
      name: "http.requests",
      dataPoints: [liveOnly],
    });

    const { result } = renderHook(() => useMetricRangePoints(metric, liveWindow("1h")));

    await waitFor(() =>
      expect(result.current.map((p) => p.id).sort()).toEqual(["live-only", "server-only"]),
    );
  });

  it("falls back to metric.dataPoints alone when the request rejects", async () => {
    requestMock.mockRejectedValue(new Error("network error"));
    const live = makeDataPoint({ id: "live-1" });
    const metric = makeMetric({ dataPoints: [live] });

    const { result } = renderHook(() => useMetricRangePoints(metric, liveWindow("1h")));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(result.current.map((p) => p.id)).toEqual(["live-1"]);
  });

  it("does not refetch when only metric.dataPoints changes (same metric identity, same range)", async () => {
    requestMock.mockResolvedValue({ metricPoints: [] });
    const metric = makeMetric({ dataPoints: [makeDataPoint({ id: "a" })] });

    const { rerender } = renderHook(({ metric: m }) => useMetricRangePoints(m, liveWindow("1h")), {
      initialProps: { metric },
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    // A new WS-delivered point arrives: a new metric object, same identity.
    const updated = { ...metric, dataPoints: [...metric.dataPoints, makeDataPoint({ id: "b" })] };
    rerender({ metric: updated });

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("refetches when the selected metric changes", async () => {
    requestMock.mockResolvedValue({ metricPoints: [] });
    const metric = makeMetric({ name: "metric.a", dataPoints: [makeDataPoint({ id: "a" })] });

    const { rerender } = renderHook(({ metric: m }) => useMetricRangePoints(m, liveWindow("1h")), {
      initialProps: { metric },
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    rerender({
      metric: makeMetric({ name: "metric.b", dataPoints: [makeDataPoint({ id: "c" })] }),
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1]?.[1]).toMatchObject({ name: "metric.b" });
  });

  it("refetches when the range changes", async () => {
    requestMock.mockResolvedValue({ metricPoints: [] });
    const metric = makeMetric({ dataPoints: [makeDataPoint({ id: "a" })] });

    const { rerender } = renderHook(
      ({ range }: { range: "1h" | "5m" }) => useMetricRangePoints(metric, liveWindow(range)),
      { initialProps: { range: "1h" } },
    );

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    rerender({ range: "5m" });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
  });

  it("keeps rendering the previous merged snapshot during a range-change refetch (no intermediate empty emission)", async () => {
    const serverPoint = makeDataPoint({ id: "server-a", timestamp: "2024-01-01T00:00:00Z" });
    requestMock.mockResolvedValueOnce({ metricPoints: [toQueryPoint(serverPoint)] });
    const metric = makeMetric({ serviceName: "frontend", name: "http.requests", dataPoints: [] });

    const { result, rerender } = renderHook(
      ({ range }: { range: "1h" | "5m" }) => useMetricRangePoints(metric, liveWindow(range)),
      { initialProps: { range: "1h" } },
    );

    await waitFor(() => expect(result.current.map((p) => p.id)).toEqual(["server-a"]));

    let resolveSecond: (value: MetricPointsQuery) => void = () => {};
    const pending = new Promise<MetricPointsQuery>((resolve) => {
      resolveSecond = resolve;
    });
    requestMock.mockImplementationOnce(() => pending);

    rerender({ range: "5m" });

    // Still showing the previous snapshot while the range-change fetch is in
    // flight — not blanked to [] and flashed down to the live buffer.
    expect(result.current.map((p) => p.id)).toEqual(["server-a"]);

    resolveSecond({ metricPoints: [] });
    // Once the range-change fetch actually resolves — even to a legitimately
    // empty result (unlike the old whole-page query, metricPoints is already
    // scoped server-side to this exact metric, so "no items" here means "no
    // points in the new range", not "no matching group in the page") — the
    // snapshot updates to match, merged with whatever the live buffer holds
    // (empty in this test).
    await waitFor(() => expect(result.current.map((p) => p.id)).toEqual([]));
  });

  it("clears the snapshot immediately when the selected metric identity changes", async () => {
    requestMock.mockResolvedValue({ metricPoints: [] });
    const metricA = makeMetric({ name: "metric.a", dataPoints: [makeDataPoint({ id: "a" })] });

    const { result, rerender } = renderHook(
      ({ metric }: { metric: MetricData }) => useMetricRangePoints(metric, liveWindow("1h")),
      { initialProps: { metric: metricA } },
    );

    await waitFor(() => expect(result.current.map((p) => p.id)).toEqual(["a"]));

    const metricB = makeMetric({ name: "metric.b", dataPoints: [] });
    rerender({ metric: metricB });

    // Cleared synchronously (before the new fetch resolves): a metric switch,
    // unlike a range change, has nothing sensible to keep showing.
    expect(result.current.map((p) => p.id)).toEqual([]);
  });
});
