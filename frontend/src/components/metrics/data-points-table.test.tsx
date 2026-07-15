import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DataPointsTable, DataPointDetail } from "./metric-detail";
import { makeDataPoint, makeMetric } from "@/test/factories";

afterEach(cleanup);

function attrRow(text: string) {
  return screen.getByText(text).closest("tr")!;
}

describe("DataPointsTable", () => {
  it("calls onSelect with the data point id when a row is clicked", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({
          id: "dp-a",
          attributes: { "http.method": "GET", "http.route": "/api/users/{id}" },
        }),
      ],
    });
    const onSelect = vi.fn();

    render(
      <DataPointsTable
        metric={metric}
        dataPoints={metric.dataPoints}
        selectedId={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(attrRow('http.method="GET", http.route="/api/users/{id}"'));

    expect(onSelect).toHaveBeenCalledWith("dp-a");
  });

  it("calls onSelect with null when the selected row is clicked again", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "dp-a", attributes: { k: "v" } })],
    });
    const onSelect = vi.fn();

    render(
      <DataPointsTable
        metric={metric}
        dataPoints={metric.dataPoints}
        selectedId="dp-a"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(attrRow('k="v"'));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("highlights the selected row", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "dp-a", attributes: { k: "va" } }),
        makeDataPoint({ id: "dp-b", attributes: { k: "vb" } }),
      ],
    });

    render(
      <DataPointsTable
        metric={metric}
        dataPoints={metric.dataPoints}
        selectedId="dp-b"
        onSelect={() => {}}
      />,
    );

    expect(attrRow('k="va"').className).not.toContain("bg-metric/10");
    expect(attrRow('k="vb"').className).toContain("bg-metric/10");
  });

  it("does not render an inline detail row for the selected data point", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "dp-a", attributes: { k: "v" } })],
    });

    render(
      <DataPointsTable
        metric={metric}
        dataPoints={metric.dataPoints}
        selectedId="dp-a"
        onSelect={() => {}}
      />,
    );

    expect(screen.queryByRole("heading", { level: 4, name: "Attributes" })).toBeNull();
  });
});

describe("DataPointDetail", () => {
  it("shows Timestamp and Value fields", () => {
    const dp = makeDataPoint({ id: "dp-a", timestamp: "2024-01-01T00:00:00Z", value: 42 });

    render(<DataPointDetail dp={dp} resource={{}} unit="" isDistribution={false} />);

    expect(screen.getByText("Timestamp")).toBeTruthy();
    expect(screen.getByText("Value")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("shows the Value field in the metric tone", () => {
    const dp = makeDataPoint({ id: "dp-a", value: 42 });

    render(<DataPointDetail dp={dp} resource={{}} unit="" isDistribution={false} />);

    expect(screen.getByText("42").className).toContain("text-metric");
  });

  it("shows Attributes with full key/value", () => {
    const dp = makeDataPoint({
      id: "dp-a",
      attributes: { "http.method": "GET", "http.route": "/api/users/{id}" },
    });

    render(<DataPointDetail dp={dp} resource={{}} unit="" isDistribution={false} />);

    expect(screen.getByRole("heading", { level: 4, name: "Attributes" })).toBeTruthy();
    expect(screen.getByText("http.method")).toBeTruthy();
    expect(screen.getByText("GET")).toBeTruthy();
    expect(screen.getByText("http.route")).toBeTruthy();
    expect(screen.getByText("/api/users/{id}")).toBeTruthy();
  });

  it("hides the Attributes section when the data point has no attributes", () => {
    const dp = makeDataPoint({ id: "dp-a", attributes: {} });

    render(
      <DataPointDetail
        dp={dp}
        resource={{ "service.name": "checkout" }}
        unit=""
        isDistribution={false}
      />,
    );

    expect(screen.queryByRole("heading", { level: 4, name: "Attributes" })).toBeNull();
  });

  it("hides the Resource section when the metric has no resource", () => {
    const dp = makeDataPoint({ id: "dp-a", attributes: { k: "v" } });

    render(<DataPointDetail dp={dp} resource={{}} unit="" isDistribution={false} />);

    expect(screen.queryByRole("heading", { level: 4, name: "Resource" })).toBeNull();
  });

  it("shows the Resource section with keys and values when resource is set", () => {
    const dp = makeDataPoint({ id: "dp-a", attributes: { k: "v" } });

    render(
      <DataPointDetail
        dp={dp}
        resource={{ "service.name": "checkout", "service.version": "1.2.3" }}
        unit=""
        isDistribution={false}
      />,
    );

    expect(screen.getByRole("heading", { level: 4, name: "Resource" })).toBeTruthy();
    expect(screen.getByText("service.name")).toBeTruthy();
    expect(screen.getByText("checkout")).toBeTruthy();
    expect(screen.getByText("service.version")).toBeTruthy();
    expect(screen.getByText("1.2.3")).toBeTruthy();
  });

  it("shows Count/Sum/Min/Max for distribution metrics, omitting null fields", () => {
    const dp = makeDataPoint({
      id: "dp-a",
      value: 12.5,
      count: 10,
      sum: 125,
      min: null,
      max: 20,
    });

    render(<DataPointDetail dp={dp} resource={{}} unit="" isDistribution={true} />);

    expect(screen.getByText("Count")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getByText("Sum")).toBeTruthy();
    expect(screen.getByText("Max")).toBeTruthy();
    expect(screen.queryByText("Min")).toBeNull();
  });

  it("does not show distribution fields for non-distribution metrics", () => {
    const dp = makeDataPoint({ id: "dp-a", value: 1, count: 10, sum: 5, min: 1, max: 2 });

    render(<DataPointDetail dp={dp} resource={{}} unit="" isDistribution={false} />);

    expect(screen.queryByText("Count")).toBeNull();
    expect(screen.queryByText("Sum")).toBeNull();
    expect(screen.queryByText("Min")).toBeNull();
    expect(screen.queryByText("Max")).toBeNull();
  });
});
