import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { useTraceSpans } from "./use-trace-spans";
import { tracesAtom } from "@/stores/telemetry";
import { makeTrace, makeSpan } from "@/test/factories";
import type { TraceSpansQuery, TraceSpansQueryVariables } from "@/gql/graphql";

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn<(doc: unknown, vars: TraceSpansQueryVariables) => Promise<TraceSpansQuery>>(),
}));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

beforeEach(() => {
  requestMock.mockReset();
});

function toQuerySpan(span: ReturnType<typeof makeSpan>) {
  const { duration, ...rest } = span;
  return { ...rest, durationMs: duration / 1_000_000 };
}

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

  it("recovers when an effect re-invocation cancels the first in-flight request (StrictMode's mount->cleanup->mount)", async () => {
    const span = makeSpan({ spanId: "s1" });
    let resolveFirst: (v: TraceSpansQuery) => void = () => {};
    const pending = new Promise<TraceSpansQuery>((resolve) => {
      resolveFirst = resolve;
    });
    requestMock.mockReturnValueOnce(pending);
    requestMock.mockResolvedValueOnce({ trace: { spans: [toQuerySpan(span)] } });

    const trace1 = makeTrace({ traceId: "t1", spanCount: 1, spans: [] });
    const { store, rerender } = renderWithStore(trace1);

    // A new trace object, same identity/state — simulates React re-running
    // the effect (StrictMode's synchronous mount->cleanup->mount) before the
    // first request resolves, which cancels attempt #1 via its cleanup.
    rerender({ t: makeTrace({ traceId: "t1", spanCount: 1, spans: [] }) });

    // Attempt #1 resolves late; being cancelled, it must not merge.
    resolveFirst({ trace: { spans: [] } });

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
