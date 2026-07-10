import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MetricChart } from "./metric-chart";
import { makeDataPoint, makeMetric } from "@/test/factories";

afterEach(cleanup);

describe("MetricChart", () => {
  it("renders a time-range selector with 1m/5m/15m/30m/1h/All, defaulting to All", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "dp-1", timestamp: "2024-01-01T00:00:00Z", value: 1 })],
    });

    render(<MetricChart metric={metric} />);

    for (const label of ["1m", "5m", "15m", "30m", "1h", "All"]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("tab", { name: "All" }).getAttribute("data-active")).not.toBeNull();
  });

  it("switches the selected range when a tab is clicked", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "dp-1", timestamp: "2024-01-01T00:00:00Z", value: 1 })],
    });

    render(<MetricChart metric={metric} />);

    fireEvent.click(screen.getByRole("tab", { name: "5m" }));

    expect(screen.getByRole("tab", { name: "5m" }).getAttribute("data-active")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "All" }).getAttribute("data-active")).toBeNull();
  });
});
