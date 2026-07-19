import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { useMetricListSearch } from "./use-metric-list-search";
import { metricSearchResultAtom, metricsAtom } from "@/stores/telemetry";
import { makeMetric } from "@/test/factories";
import type { MetricsListQuery, MetricsListQueryVariables } from "@/gql/graphql";

const { requestMock } = vi.hoisted(() => ({
  requestMock:
    vi.fn<(doc: unknown, vars: MetricsListQueryVariables) => Promise<MetricsListQuery>>(),
}));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

beforeEach(() => {
  requestMock.mockReset();
});

function renderWithStore(search: string) {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(({ search: s }) => useMetricListSearch(s), {
    wrapper,
    initialProps: { search },
  });
  return { store, ...view };
}

function queryMetric(overrides = {}) {
  const { dataPoints: _dataPoints, ...metric } = makeMetric(overrides);
  return metric;
}

describe("useMetricListSearch", () => {
  it("never writes metricsAtom even on a zero-hit search", async () => {
    requestMock.mockResolvedValue({ metrics: { items: [] } });
    const { store } = renderWithStore("nomatch");
    store.set(metricsAtom, [makeMetric({ serviceName: "frontend", name: "http.requests" })]);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    // The buffer is untouched by the search result — this is the bug fix:
    // the old hook replaced metricsAtom itself with the (possibly empty)
    // search result, which wiped the canonical buffer on a zero-hit search.
    expect(store.get(metricsAtom)).toHaveLength(1);
    expect(store.get(metricSearchResultAtom)).toEqual({ search: "nomatch", items: [] });
  });

  it("records full server summaries without touching the canonical buffer", async () => {
    requestMock.mockResolvedValue({
      metrics: { items: [queryMetric({ name: "retained.metric", serviceName: "backend" })] },
    });
    const { store } = renderWithStore("http");
    const original = [makeMetric({ serviceName: "frontend", name: "http.requests" })];
    store.set(metricsAtom, original);

    await waitFor(() => expect(store.get(metricSearchResultAtom).items).toHaveLength(1));
    expect(store.get(metricSearchResultAtom)).toEqual({
      search: "http",
      items: [makeMetric({ name: "retained.metric", serviceName: "backend" })],
    });
    expect(store.get(metricsAtom)).toBe(original);
  });

  it("leaves every empty-search bootstrap to useInitialLoad", () => {
    const store = createStore();
    store.set(metricsAtom, [makeMetric()]);

    // Mount fresh — as the metrics tab does — with the buffer already
    // populated (e.g. by hooks/use-initial-load.ts) and no active search.
    renderHook(() => useMetricListSearch(""), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    });

    expect(requestMock).not.toHaveBeenCalled();
  });

  it("fetches again when the search text changes", async () => {
    requestMock.mockResolvedValue({ metrics: { items: [] } });
    const { rerender } = renderWithStore("a");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    rerender({ search: "ab" });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1]?.[1]?.search).toBe("ab");
  });
});
