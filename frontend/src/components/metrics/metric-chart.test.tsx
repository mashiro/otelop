import { describe, it, expect, afterEach } from "vite-plus/test";
import { render, cleanup } from "@testing-library/react";
import { MetricChart } from "./metric-chart";
import { makeDataPoint, makeMetric } from "@/test/factories";
import type { MetricFacet } from "@/lib/metric-catalog";

// Range selection and data fetching are lifted to metric-detail.tsx (see its
// tests for the control row and the useMetricRangePoints/
// useMetricAggregateSeries wiring); MetricChart is now a pure rendering
// component driven entirely by props.
//
// ParentSize never reports a nonzero size under jsdom (no ResizeObserver
// signal fires), so ChartInner — and with it every SVG/legend element —
// never actually mounts in this test environment. These tests only assert
// that MetricChart renders without the props it's given (a smoke test for
// the data plumbing), matching the pre-existing limitation noted in
// use-metric-aggregate-series.test.ts and metric-detail's own tests.
const REGION_FACET: MetricFacet = { attributes: ["region"], label: "Region" };

afterEach(cleanup);

describe("MetricChart", () => {
  it("renders with raw range points and no facet", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "dp-1", timestamp: "2024-01-01T00:00:00Z", value: 1 })],
    });

    expect(() =>
      render(
        <MetricChart
          metric={metric}
          facet={null}
          window={{ mode: "live", range: "all" }}
          aggregatedSeries={null}
        />,
      ),
    ).not.toThrow();
  });

  it("renders with a facet active and server-aggregated series", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "a1", attributes: { region: "A", worker: "1" }, value: 5 }),
        makeDataPoint({ id: "a2", attributes: { region: "A", worker: "2" }, value: 3 }),
      ],
    });

    expect(() =>
      render(
        <MetricChart
          metric={metric}
          facet={REGION_FACET}
          window={{ mode: "live", range: "5m" }}
          aggregatedSeries={[]}
        />,
      ),
    ).not.toThrow();
  });

  it("renders while the aggregated fetch hasn't landed yet (null)", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "a1", attributes: { region: "A" }, value: 1 })],
    });

    expect(() =>
      render(
        <MetricChart
          metric={metric}
          facet={REGION_FACET}
          window={{ mode: "live", range: "all" }}
          aggregatedSeries={null}
        />,
      ),
    ).not.toThrow();
  });
});
