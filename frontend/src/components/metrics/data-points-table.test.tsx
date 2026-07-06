import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DataPointsTable } from "./metric-detail";
import { makeDataPoint, makeMetric } from "@/test/factories";

afterEach(cleanup);

function attrRow(text: string) {
  return screen.getByText(text).closest("tr")!;
}

function attributesHeading() {
  return screen.queryByRole("heading", { level: 4, name: "Attributes" });
}

function resourceHeading() {
  return screen.queryByRole("heading", { level: 4, name: "Resource" });
}

describe("DataPointsTable", () => {
  it("expands a row on click and shows Attributes with full key/value", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({
          id: "dp-a",
          attributes: { "http.method": "GET", "http.route": "/api/users/{id}" },
        }),
      ],
    });

    render(<DataPointsTable metric={metric} />);
    expect(attributesHeading()).toBeNull();

    fireEvent.click(attrRow('http.method="GET", http.route="/api/users/{id}"'));

    expect(attributesHeading()).toBeTruthy();
    expect(screen.getByText("http.method")).toBeTruthy();
    expect(screen.getByText("GET")).toBeTruthy();
    expect(screen.getByText("http.route")).toBeTruthy();
    expect(screen.getByText("/api/users/{id}")).toBeTruthy();
  });

  it("collapses the same row on second click", () => {
    const metric = makeMetric({
      dataPoints: [makeDataPoint({ id: "dp-a", attributes: { k: "v" } })],
    });

    render(<DataPointsTable metric={metric} />);
    const row = attrRow('k="v"');

    fireEvent.click(row);
    expect(attributesHeading()).toBeTruthy();

    fireEvent.click(row);
    expect(attributesHeading()).toBeNull();
  });

  it("closes the previous row when another row is expanded", () => {
    const metric = makeMetric({
      dataPoints: [
        makeDataPoint({ id: "dp-a", attributes: { k: "va" } }),
        makeDataPoint({ id: "dp-b", attributes: { k: "vb" } }),
      ],
    });

    render(<DataPointsTable metric={metric} />);

    fireEvent.click(attrRow('k="va"'));
    expect(screen.getAllByRole("heading", { level: 4, name: "Attributes" })).toHaveLength(1);
    expect(screen.getByText("va")).toBeTruthy();

    fireEvent.click(attrRow('k="vb"'));
    expect(screen.getAllByRole("heading", { level: 4, name: "Attributes" })).toHaveLength(1);
    expect(screen.getByText("vb")).toBeTruthy();
    expect(screen.queryByText("va")).toBeNull();
  });

  it("hides the Resource section when the metric has no resource", () => {
    const metric = makeMetric({
      resource: {},
      dataPoints: [makeDataPoint({ id: "dp-a", attributes: { k: "v" } })],
    });

    render(<DataPointsTable metric={metric} />);
    fireEvent.click(attrRow('k="v"'));

    expect(attributesHeading()).toBeTruthy();
    expect(resourceHeading()).toBeNull();
  });

  it("shows the Resource section with keys and values when resource is set", () => {
    const metric = makeMetric({
      resource: { "service.name": "checkout", "service.version": "1.2.3" },
      dataPoints: [makeDataPoint({ id: "dp-a", attributes: { k: "v" } })],
    });

    render(<DataPointsTable metric={metric} />);
    fireEvent.click(attrRow('k="v"'));

    expect(resourceHeading()).toBeTruthy();
    expect(screen.getByText("service.name")).toBeTruthy();
    expect(screen.getByText("checkout")).toBeTruthy();
    expect(screen.getByText("service.version")).toBeTruthy();
    expect(screen.getByText("1.2.3")).toBeTruthy();
  });

  it("hides the Attributes section when the expanded data point has no attributes", () => {
    const metric = makeMetric({
      resource: { "service.name": "checkout" },
      dataPoints: [makeDataPoint({ id: "dp-a", attributes: {} })],
    });

    render(<DataPointsTable metric={metric} />);
    const bodyRow = document.querySelector("tbody tr")!;
    fireEvent.click(bodyRow);

    expect(attributesHeading()).toBeNull();
    expect(resourceHeading()).toBeTruthy();
  });
});
