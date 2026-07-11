import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { Temporal } from "temporal-polyfill";
import type { ReactNode } from "react";
import { useServiceMapSpans } from "./use-service-map-spans";
import { tracesAtom } from "@/stores/telemetry";
import { makeTrace, makeSpan } from "@/test/factories";
import type { ChartTimeRange } from "@/lib/chart-time-range";
import type { ServiceMapSpansQuery, ServiceMapSpansQueryVariables } from "@/gql/graphql";

const { requestMock } = vi.hoisted(() => ({
  requestMock:
    vi.fn<(doc: unknown, vars: ServiceMapSpansQueryVariables) => Promise<ServiceMapSpansQuery>>(),
}));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

beforeEach(() => {
  requestMock.mockReset();
});

function toQuerySpan(span: ReturnType<typeof makeSpan>) {
  const { duration, ...rest } = span;
  return { ...rest, durationMs: duration / 1_000_000 };
}

function renderWithStore(
  initialActive: boolean,
  traces: ReturnType<typeof makeTrace>[],
  initialRange: ChartTimeRange = "1h",
) {
  const store = createStore();
  store.set(tracesAtom, traces);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(({ active, range }) => useServiceMapSpans(active, range), {
    wrapper,
    initialProps: { active: initialActive, range: initialRange },
  });
  return { store, ...view };
}

describe("useServiceMapSpans", () => {
  it("does not fetch while inactive", () => {
    renderWithStore(false, [makeTrace({ traceId: "t1", spans: [] })]);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("scopes the bulk fetch to the selected range via `from`, omitting it for 'all'", async () => {
    requestMock.mockResolvedValue({ traces: { items: [] } });
    const before = Temporal.Now.instant();

    renderWithStore(true, [makeTrace({ traceId: "t1", spans: [] })], "5m");

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const from = requestMock.mock.calls[0]?.[1]?.from;
    const fromInstant = Temporal.Instant.from(from!);
    const deltaMs = before.since(fromInstant).total("milliseconds");
    expect(deltaMs).toBeGreaterThan(4.9 * 60_000);
    expect(deltaMs).toBeLessThan(5.1 * 60_000);

    requestMock.mockClear();
    renderWithStore(true, [makeTrace({ traceId: "t2", spans: [] })], "all");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0]?.[1]).toEqual({ from: undefined });
  });

  it("refetches when the range changes while active", async () => {
    requestMock.mockResolvedValue({ traces: { items: [] } });

    const { rerender } = renderWithStore(true, [makeTrace({ traceId: "t1", spans: [] })], "1h");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    rerender({ active: true, range: "6h" });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
  });

  it("does not refetch when reactivated with the same range", async () => {
    requestMock.mockResolvedValue({ traces: { items: [] } });

    const { rerender } = renderWithStore(true, [makeTrace({ traceId: "t1", spans: [] })], "1h");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    rerender({ active: false, range: "1h" });
    rerender({ active: true, range: "1h" });

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("bulk-fetches and merges spans for every buffered trace once activated", async () => {
    const spanA = makeSpan({ spanId: "a", serviceName: "svc-a" });
    const spanB = makeSpan({ spanId: "b", serviceName: "svc-b" });
    requestMock.mockResolvedValue({
      traces: {
        items: [
          { traceId: "t1", spans: [toQuerySpan(spanA)] },
          { traceId: "t2", spans: [toQuerySpan(spanB)] },
        ],
      },
    });

    const { store } = renderWithStore(true, [
      makeTrace({ traceId: "t1", spanCount: 1, spans: [] }),
      makeTrace({ traceId: "t2", spanCount: 1, spans: [] }),
    ]);

    await waitFor(() => {
      const traces = store.get(tracesAtom);
      expect(traces.find((t) => t.traceId === "t1")?.spans).toHaveLength(1);
      expect(traces.find((t) => t.traceId === "t2")?.spans).toHaveLength(1);
    });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("only fetches once across repeated activations", async () => {
    requestMock.mockResolvedValue({ traces: { items: [] } });

    const { rerender } = renderWithStore(true, [makeTrace({ traceId: "t1", spans: [] })]);
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    rerender({ active: false, range: "1h" });
    rerender({ active: true, range: "1h" });

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("recovers when deactivated and reactivated before the first request resolves (StrictMode-style cancellation)", async () => {
    let resolveFirst: (v: ServiceMapSpansQuery) => void = () => {};
    const pending = new Promise<ServiceMapSpansQuery>((resolve) => {
      resolveFirst = resolve;
    });
    requestMock.mockReturnValueOnce(pending);
    requestMock.mockResolvedValueOnce({
      traces: { items: [{ traceId: "t1", spans: [toQuerySpan(makeSpan({ spanId: "a" }))] }] },
    });

    const { store, rerender } = renderWithStore(true, [
      makeTrace({ traceId: "t1", spanCount: 1, spans: [] }),
    ]);

    // Deactivating before the first request resolves cancels it via cleanup
    // — the eager "mark as fetched at dispatch time" bug this guards
    // against would have blocked the second, uncancelled attempt below from
    // ever starting, permanently starving the map of span data.
    rerender({ active: false, range: "1h" });
    rerender({ active: true, range: "1h" });

    // Late resolution of the cancelled first attempt must not apply.
    resolveFirst({ traces: { items: [] } });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(store.get(tracesAtom)[0].spans).toHaveLength(1));
  });

  it("allows a retry on the next activation when the fetch rejects", async () => {
    requestMock.mockRejectedValueOnce(new Error("network error"));
    requestMock.mockResolvedValueOnce({
      traces: { items: [{ traceId: "t1", spans: [toQuerySpan(makeSpan({ spanId: "a" }))] }] },
    });

    const { store, rerender } = renderWithStore(true, [
      makeTrace({ traceId: "t1", spanCount: 1, spans: [] }),
    ]);
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    rerender({ active: false, range: "1h" });
    rerender({ active: true, range: "1h" });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(store.get(tracesAtom)[0].spans).toHaveLength(1));
  });
});
