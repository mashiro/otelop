import { queryClient } from "@/lib/query-client";
import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { useTraceSpans } from "./use-trace-spans";
import { tracesAtom } from "@/stores/telemetry";
import { makeTrace, makeSpan, toQuerySpan } from "@/test/factories";
import type { TraceSpansQuery, TraceSpansQueryVariables } from "@/gql/graphql";

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn<(doc: unknown, vars: TraceSpansQueryVariables) => Promise<TraceSpansQuery>>(),
}));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

beforeEach(() => {
  requestMock.mockReset();
});

function renderWithStore(trace: Parameters<typeof useTraceSpans>[0]) {
  const store = createStore();
  if (trace) store.set(tracesAtom, [trace]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(({ t }) => useTraceSpans(t), { wrapper, initialProps: { t: trace } });
  return { store, ...view };
}

describe("useTraceSpans", () => {
  it("fetches and merges full span data for a trace whose spans aren't loaded yet", async () => {
    const span = makeSpan({ spanId: "s1" });
    requestMock.mockResolvedValue({ trace: { spans: [toQuerySpan(span)] } });
    const trace = makeTrace({ traceId: "t1", spanCount: 1, spans: [] });

    const { store } = renderWithStore(trace);

    await waitFor(() => expect(store.get(tracesAtom)[0].spans).toHaveLength(1));
    expect(store.get(tracesAtom)[0].spans[0].spanId).toBe("s1");
    expect(requestMock).toHaveBeenCalledWith(expect.anything(), { traceId: "t1" });
  });

  it("does not fetch when the trace is null", () => {
    renderWithStore(null);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("does not fetch when spans are already fully loaded (spans.length >= spanCount)", () => {
    const trace = makeTrace({ traceId: "t1", spanCount: 1, spans: [makeSpan()] });
    renderWithStore(trace);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("does not overwrite complete live spans with an older cached response", () => {
    const oldSpan = makeSpan({ spanId: "s1", name: "old" });
    queryClient.setQueryData(["trace-spans", "t1", 1], {
      trace: { spans: [toQuerySpan(oldSpan)] },
    });
    const liveSpan = makeSpan({ spanId: "s1", name: "live" });
    const { store } = renderWithStore(
      makeTrace({ traceId: "t1", spanCount: 1, spans: [liveSpan] }),
    );
    expect(store.get(tracesAtom)[0].spans[0].name).toBe("live");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("does not refetch on rerender once a trace's spans have been requested", async () => {
    const span = makeSpan({ spanId: "s1" });
    requestMock.mockResolvedValue({ trace: { spans: [toQuerySpan(span)] } });
    const trace = makeTrace({ traceId: "t1", spanCount: 1, spans: [] });

    const { rerender } = renderWithStore(trace);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    // Same object identity re-render (e.g. an unrelated store update) must
    // not re-trigger the effect at all, let alone the request.
    rerender({ t: trace });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("shares the in-flight request when the same trace is rendered again", async () => {
    const span = makeSpan({ spanId: "s1" });
    let resolveFirst: (v: TraceSpansQuery) => void = () => {};
    const pending = new Promise<TraceSpansQuery>((resolve) => {
      resolveFirst = resolve;
    });
    requestMock.mockReturnValueOnce(pending);

    const trace1 = makeTrace({ traceId: "t1", spanCount: 1, spans: [] });
    const { store, rerender } = renderWithStore(trace1);

    rerender({ t: makeTrace({ traceId: "t1", spanCount: 1, spans: [] }) });
    expect(requestMock).toHaveBeenCalledTimes(1);
    resolveFirst({ trace: { spans: [toQuerySpan(span)] } });

    await waitFor(() => expect(store.get(tracesAtom)[0].spans).toHaveLength(1));
    expect(store.get(tracesAtom)[0].spans[0].spanId).toBe("s1");
  });

  it("leaves spans empty (does not throw) when the fetch rejects", async () => {
    requestMock.mockRejectedValue(new Error("network error"));
    const trace = makeTrace({ traceId: "t1", spanCount: 1, spans: [] });

    const { store } = renderWithStore(trace);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(store.get(tracesAtom)[0].spans).toEqual([]);
  });
});
