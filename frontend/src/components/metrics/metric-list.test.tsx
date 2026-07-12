import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { getDefaultStore } from "jotai";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MetricList } from "./metric-list";
import { metricsAtom } from "@/stores/telemetry";
import { metricSearchAtom } from "@/stores/filters";
import { selectedMetricKeyAtom } from "@/stores/navigation";
import { makeMetric } from "@/test/factories";

// Base UI's ScrollArea calls Element.getAnimations(), which happy-dom (this
// project's test environment) doesn't implement — see the identical mock in
// metric-detail.test.tsx.
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/hooks/use-metric-list-search", () => ({
  useMetricListSearch: vi.fn(),
}));

beforeEach(() => {
  const store = getDefaultStore();
  store.set(metricsAtom, []);
  store.set(metricSearchAtom, "");
  store.set(selectedMetricKeyAtom, null);
});
afterEach(cleanup);

// The metrics list's initial load stopped selecting dataPoints (issue #162);
// the "Points"/"Latest Value" columns must render from the cheap
// pointCount/latestValue summary fields the server computes instead of
// deriving them from dataPoints.length / dataPoints.at(-1)?.value.
describe("MetricList", () => {
  it("renders Points/Latest Value from pointCount/latestValue, not dataPoints", () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [
      makeMetric({
        serviceName: "frontend",
        name: "http.requests",
        pointCount: 42,
        latestValue: 7.5,
        dataPoints: [],
      }),
    ]);

    render(<MetricList />);

    expect(screen.getByText("http.requests")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("7.5")).toBeTruthy();
  });

  it("renders '-' for latestValue when null (no meaningful point yet)", () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [
      makeMetric({ name: "fresh.metric", pointCount: 0, latestValue: null, dataPoints: [] }),
    ]);

    render(<MetricList />);

    expect(screen.getByText("fresh.metric")).toBeTruthy();
    // Column order (see MetricList): Service, Name, Description, Type, Unit,
    // Points, Latest Value, Received — index 6 is Latest Value.
    const row = screen.getByText("fresh.metric").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[5]?.textContent).toBe("0");
    expect(cells[6]?.textContent).toBe("-");
  });
});
