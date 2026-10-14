import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore } from "jotai";
import { expect, it, vi } from "vite-plus/test";
import { createTestRouter } from "@/test/router";
import { TraceList } from "./trace-list";
import {
  addTraceAtom,
  tracesAtom,
  renderWindowMaxAtom,
  traceListWindowAtom,
} from "@/stores/telemetry";
import { makeTrace } from "@/test/factories";
import type { ReactNode } from "react";
const probe = vi.hoisted(() => ({ detail: vi.fn(), renderWindow: vi.fn() }));
vi.mock("./trace-detail", () => ({
  TraceDetail: () => {
    probe.detail();
    return <div>Trace details</div>;
  },
}));
vi.mock("@/hooks/use-trace-by-id", () => ({ useTraceById: () => ({ status: "idle" }) }));
vi.mock("@/hooks/use-trace-list-page", () => ({
  useTraceListPage: () => ({ hasMore: false, requestKey: "all", loadingMore: false }),
}));
vi.mock("@/hooks/use-render-window", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/hooks/use-render-window")>();
  return {
    useRenderWindow: (...args: Parameters<typeof original.useRenderWindow>) => {
      probe.renderWindow();
      return original.useRenderWindow(...args);
    },
  };
});
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

it("pauses hidden list subscriptions while preserving its browsing position", async () => {
  const store = createStore();
  store.set(traceListWindowAtom, { mode: "live", range: "all" });
  store.set(renderWindowMaxAtom, 2);
  const rows = Array.from({ length: 6 }, (_, i) => makeTrace({ traceId: `t${i}` }));
  store.set(tracesAtom, rows);
  const { router, wrapper } = await createTestRouter("/traces?range=all", store);
  render(<TraceList />, { wrapper });
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(screen.getByText("t2")).toBeDefined();
  await act(async () => {
    await router.navigate({ to: "/traces/$traceId", params: { traceId: "t2" }, search: true });
  });
  const before = probe.renderWindow.mock.calls.length;
  act(() => store.set(addTraceAtom, makeTrace({ traceId: "live" })));
  expect(probe.renderWindow.mock.calls.length).toBe(before);
  await act(async () => {
    await router.navigate({ to: "/traces", search: true });
  });
  expect(screen.getByText("t2")).toBeDefined();
  expect(screen.queryByText("live")).toBeNull();
});
