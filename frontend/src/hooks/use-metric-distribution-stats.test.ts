import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMetricDistributionStats } from "./use-metric-distribution-stats";
import { makeMetric } from "@/test/factories";
import type {
  MetricDistributionStatsQuery,
  MetricDistributionStatsQueryVariables,
} from "@/gql/graphql";

const { requestMock } = vi.hoisted(() => ({
  requestMock:
    vi.fn<
      (
        doc: unknown,
        vars: MetricDistributionStatsQueryVariables,
      ) => Promise<MetricDistributionStatsQuery>
    >(),
}));

vi.mock("@/lib/graphql", () => ({
  gqlClient: { request: requestMock },
}));

beforeEach(() => requestMock.mockReset());

const liveWindow = { mode: "live" as const, range: "all" as const };
const opus = {
  groupValues: ["opus"],
  attributes: {},
  count: 10,
  mean: 5,
  min: 1,
  max: 9,
  p50: 5,
  p90: 8,
  p95: 9,
  p99: 9,
};

describe("useMetricDistributionStats", () => {
  it("does not fetch for a non-histogram metric", () => {
    const metric = makeMetric({ type: "Gauge" });
    const { result } = renderHook(() => useMetricDistributionStats(metric, liveWindow, ["model"]));

    expect(result.current).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("fetches and returns statistics for the requested breakdown", async () => {
    requestMock.mockResolvedValue({ metricDistributionStats: [opus] });
    const metric = makeMetric({ type: "Histogram", serviceName: "svc", name: "latency" });
    const { result } = renderHook(() => useMetricDistributionStats(metric, liveWindow, ["model"]));

    await waitFor(() => expect(result.current).toEqual([opus]));
    expect(requestMock.mock.calls[0]?.[1]).toMatchObject({
      serviceName: "svc",
      name: "latency",
      groupBy: ["model"],
      from: undefined,
      to: undefined,
    });
  });

  it("omits groupBy for the full-attribute All view", async () => {
    requestMock.mockResolvedValue({
      metricDistributionStats: [{ ...opus, groupValues: [], attributes: { model: "opus" } }],
    });
    const metric = makeMetric({ type: "Histogram" });
    renderHook(() => useMetricDistributionStats(metric, liveWindow, null));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0]?.[1].groupBy).toBeUndefined();
  });

  it("invalidates and refetches when the breakdown changes", async () => {
    requestMock.mockResolvedValue({ metricDistributionStats: [opus] });
    const metric = makeMetric({ type: "Histogram" });
    const { result, rerender } = renderHook(
      ({ groupBy }: { groupBy: string[] }) =>
        useMetricDistributionStats(metric, liveWindow, groupBy),
      { initialProps: { groupBy: ["model"] } },
    );
    await waitFor(() => expect(result.current).toEqual([opus]));

    rerender({ groupBy: ["worker"] });
    expect(result.current).toBeNull();
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1]?.[1].groupBy).toEqual(["worker"]);
  });
});
