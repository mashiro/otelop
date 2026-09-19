import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore } from "jotai";
import { describe, expect, it, vi } from "vite-plus/test";
import { createTestRouter } from "@/test/router";
import { makeSpan, makeTrace } from "@/test/factories";
import { tracesAtom } from "@/stores/telemetry";
import { TraceDetail } from "./trace-detail";

vi.mock("@visx/responsive", () => ({
  useParentSize: () => ({ parentRef: { current: null }, width: 900, height: 600 }),
}));

vi.mock("@/hooks/use-trace-spans", () => ({ useTraceSpans: () => {} }));

async function setup(path: string) {
  const store = createStore();
  store.set(tracesAtom, [makeTrace({ spans: [makeSpan()] })]);
  const { router, wrapper } = await createTestRouter(path, store);
  render(<TraceDetail />, { wrapper });
  return router;
}

describe("span detail navigation", () => {
  it("records span selection and restores it through browser history", async () => {
    const router = await setup("/traces/t1?range=6h");
    fireEvent.click(screen.getByRole("button", { name: "GET /api timeline" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/traces/t1/spans/s1"));
    expect(screen.getByText("Span Details")).toBeDefined();
    expect(router.state.location.search.range).toBe("6h");
    fireEvent.click(screen.getByRole("button", { name: "Close span details" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/traces/t1"));
    act(() => router.history.back());
    await screen.findByText("Span Details");
    act(() => router.history.forward());
    await waitFor(() => expect(screen.queryByText("Span Details")).toBeNull());
  });

  it("opens a span URL directly and dismisses one detail level per Escape", async () => {
    const router = await setup("/traces/t1/spans/s1?range=6h");
    expect(screen.getByText("Span Details")).toBeDefined();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/traces/t1"));
    expect(screen.queryByText("Span Details")).toBeNull();
    expect(screen.getByRole("button", { name: "Close details" })).toBeDefined();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/traces"));
    expect(router.state.location.search.range).toBe("6h");
  });
});
