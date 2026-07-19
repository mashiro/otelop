import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import type { TraceByIdQuery, TraceByIdQueryVariables } from "@/gql/graphql";
import { tracesAtom } from "@/stores/telemetry";
import { makeSpan, makeTrace, toQuerySpan } from "@/test/factories";
import { useTraceById } from "./use-trace-by-id";

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn<(doc: unknown, vars: TraceByIdQueryVariables) => Promise<TraceByIdQuery>>(),
}));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

beforeEach(() => {
  requestMock.mockReset();
});

function renderWithStore(
  traceId: string | null,
  trace = null as ReturnType<typeof makeTrace> | null,
) {
  const store = createStore();
  if (trace) store.set(tracesAtom, [trace]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(({ id, current }) => useTraceById(id, current), {
    wrapper,
    initialProps: { id: traceId, current: trace },
  });
  return { store, ...view };
}

function retainedTrace(traceId = "outside-page"): NonNullable<TraceByIdQuery["trace"]> {
  const span = makeSpan({ traceId, spanId: "span-1" });
  return {
    traceId,
    serviceName: "api",
    spanCount: 1,
    startTime: span.startTime,
    durationMs: 12,
    rootSpan: {
      name: span.name,
      kind: span.kind,
      statusCode: span.statusCode,
      durationMs: 12,
    },
    spans: [toQuerySpan(span)],
  };
}

describe("useTraceById", () => {
  it("fetches and caches a selected trace outside the current list page", async () => {
    requestMock.mockResolvedValue({ trace: retainedTrace() });

    const { store } = renderWithStore("outside-page");

    await waitFor(() => expect(store.get(tracesAtom)).toHaveLength(1));
    const trace = store.get(tracesAtom)[0];
    expect(trace.traceId).toBe("outside-page");
    expect(trace.duration).toBe(12_000_000);
    expect(trace.spans.map((span) => span.spanId)).toEqual(["span-1"]);
    expect(requestMock).toHaveBeenCalledWith(expect.anything(), { traceId: "outside-page" });
  });

  it("does not fetch when the selected trace is already buffered", () => {
    const trace = makeTrace({ traceId: "buffered" });

    renderWithStore("buffered", trace);

    expect(requestMock).not.toHaveBeenCalled();
  });

  it("reports when the referenced trace is no longer retained", async () => {
    requestMock.mockResolvedValue({ trace: null });

    const { result } = renderWithStore("expired");

    await waitFor(() => expect(result.current.status).toBe("not-found"));
  });

  it("can retry a failed focused request", async () => {
    requestMock.mockRejectedValueOnce(new Error("network error"));
    requestMock.mockResolvedValueOnce({ trace: retainedTrace("retry") });

    const { result, store } = renderWithStore("retry");
    await waitFor(() => expect(result.current.status).toBe("error"));

    result.current.retry();

    await waitFor(() => expect(store.get(tracesAtom)[0]?.traceId).toBe("retry"));
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});
