import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { getDefaultStore } from "jotai";
import { render, screen, cleanup, within, waitFor, act } from "@testing-library/react";
import { MetricList } from "./metric-list";
import { metricSearchResultAtom, metricsAtom } from "@/stores/telemetry";
import { metricSearchAtom } from "@/stores/filters";
import { selectedMetricKeyAtom } from "@/stores/navigation";
import { makeMetric } from "@/test/factories";
import type { MetricsListQuery, MetricsListQueryVariables } from "@/gql/graphql";

// Base UI's ScrollArea calls Element.getAnimations(), which happy-dom (this
// project's test environment) doesn't implement — see the identical mock in
// metric-detail.test.tsx.
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// The hook is exercised for real (not mocked) in this file now: the bug this
// suite guards against (a zero-hit search wiping metricsAtom, taking the
// search box down with it) lives in the wiring between MetricList,
// hooks/use-metric-list-search.ts, and stores/filters.ts's
// filteredMetricsAtom, not in any one of them alone.
const { requestMock } = vi.hoisted(() => ({
  requestMock:
    vi.fn<(doc: unknown, vars: MetricsListQueryVariables) => Promise<MetricsListQuery>>(),
}));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

beforeEach(() => {
  const store = getDefaultStore();
  store.set(metricsAtom, []);
  store.set(metricSearchAtom, "");
  store.set(selectedMetricKeyAtom, null);
  store.set(metricSearchResultAtom, { search: "", items: [] });
  requestMock.mockReset();
  requestMock.mockResolvedValue({ metrics: { items: [] } });
});
afterEach(cleanup);

function queryMetric(overrides = {}) {
  const { dataPoints: _dataPoints, ...metric } = makeMetric(overrides);
  return metric;
}

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

  // The blocker this suite exists to catch: a search with zero matches used
  // to REPLACE metricsAtom with the (empty) server result, and
  // metric-list.tsx's `allMetrics.length === 0` guard then rendered the full
  // EmptyState — unmounting the toolbar, the search box, and any way back.
  it("a zero-hit active search keeps the search box mounted instead of falling back to EmptyState", async () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [makeMetric({ serviceName: "frontend", name: "http.requests" })]);
    store.set(metricSearchAtom, "nomatch");
    requestMock.mockResolvedValue({ metrics: { items: [] } });

    render(<MetricList />);

    await waitFor(() => expect(screen.getByText("No matching metrics")).toBeTruthy());
    expect(screen.getByPlaceholderText("Search metrics...")).toBeTruthy();
  });

  it("recovers the list once a zero-hit search is cleared", async () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [makeMetric({ serviceName: "frontend", name: "http.requests" })]);
    store.set(metricSearchAtom, "nomatch");
    requestMock.mockResolvedValue({ metrics: { items: [] } });

    render(<MetricList />);
    await waitFor(() => expect(screen.getByText("No matching metrics")).toBeTruthy());

    act(() => {
      store.set(metricSearchAtom, "");
    });

    await waitFor(() => expect(screen.getByText("http.requests")).toBeTruthy());
  });

  it("does not clobber the metrics buffer on a zero-hit search", async () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [
      makeMetric({ serviceName: "frontend", name: "http.requests" }),
      makeMetric({ serviceName: "frontend", name: "http.errors" }),
    ]);
    store.set(metricSearchAtom, "nomatch");
    requestMock.mockResolvedValue({ metrics: { items: [] } });

    render(<MetricList />);

    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(store.get(metricsAtom)).toHaveLength(2);
  });

  it("renders a server match that is no longer present in the bounded live buffer", async () => {
    const store = getDefaultStore();
    store.set(metricsAtom, []);
    store.set(metricSearchAtom, "archive");
    requestMock.mockResolvedValue({
      metrics: { items: [queryMetric({ serviceName: "archive", name: "old.requests" })] },
    });

    render(<MetricList />);

    await waitFor(() => expect(screen.getByText("old.requests")).toBeTruthy());
    expect(store.get(metricsAtom)).toEqual([]);
    expect(screen.getByPlaceholderText("Search metrics...")).toBeTruthy();
  });

  it("skips the redundant full-list fetch on mount when search is empty and the buffer already has data", async () => {
    const store = getDefaultStore();
    store.set(metricsAtom, [makeMetric({ name: "http.requests" })]);
    store.set(metricSearchAtom, "");

    render(<MetricList />);

    // Give any accidental fetch a tick to fire before asserting its absence.
    await act(async () => Promise.resolve());
    expect(requestMock).not.toHaveBeenCalled();
  });
});
