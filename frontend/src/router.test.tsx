import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, Outlet, RouterProvider } from "@tanstack/react-router";
import { getDefaultStore } from "jotai";
import { Header } from "@/components/layout/header";
import {
  activeTabAtom,
  selectedMetricKeyAtom,
  selectedTraceIdAtom,
  traceQueryStateAtom,
  eventTimeWindowAtom,
} from "@/stores/navigation";
import { createAppRouter } from "./router";

vi.unmock("@/lib/navigation-driver");
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: async () => ({ trace: null }) } }));
vi.mock("@/hooks/use-initial-load", () => ({
  initialLoadOptions: { queryKey: ["router-test-bootstrap"], queryFn: async () => ({}) },
}));
vi.mock("./App", () => ({
  default: () => (
    <>
      <Header />
      <Outlet />
    </>
  ),
}));
vi.mock("./components/traces/trace-list", () => ({ TraceList: () => <p>Trace route</p> }));
vi.mock("./components/logs/log-list", () => ({ LogList: () => <p>Log route</p> }));
vi.mock("./components/metrics/metric-list", () => ({ MetricList: () => <p>Metric route</p> }));

const store = getDefaultStore();
let router: ReturnType<typeof createAppRouter>;
beforeEach(async () => {
  router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
  await router.load();
});

async function show(href: string) {
  await router.navigate({ href });
  render(<RouterProvider router={router} />);
}

describe("application routing", () => {
  it("uses the home Link without reloading and restores filters on back/forward", async () => {
    const href =
      "/traces/abc?range=6h&q=checkout&filter=service_name%3Aapi&filter=status_code%3Aerror#detail";
    await show(href);
    expect(await screen.findByText("Trace route")).toBeDefined();
    expect(store.get(selectedTraceIdAtom)).toBe("abc");
    expect(store.get(traceQueryStateAtom).filters).toHaveLength(2);
    expect(fireEvent.click(screen.getByRole("link", { name: "otelop" }))).toBe(false);
    await waitFor(() => expect(router.state.location.href).toBe("/"));
    expect(store.get(selectedTraceIdAtom)).toBeNull();
    expect(store.get(traceQueryStateAtom)).toEqual({ text: "", filters: [] });
    expect(store.get(eventTimeWindowAtom)).toEqual({ mode: "live", range: "1h" });

    act(() => router.history.back());
    await waitFor(() => expect(store.get(selectedTraceIdAtom)).toBe("abc"));
    expect(store.get(traceQueryStateAtom).text).toBe("checkout");
    expect(store.get(traceQueryStateAtom).filters).toHaveLength(2);
    expect(store.get(eventTimeWindowAtom)).toEqual({ mode: "live", range: "6h" });
    act(() => router.history.forward());
    await waitFor(() => expect(store.get(selectedTraceIdAtom)).toBeNull());
  });

  it("routes atom writes through Router and decodes metric path parameters", async () => {
    await show("/metrics/api%2Fworker/cpu.usage?range=24h");
    expect(await screen.findByText("Metric route")).toBeDefined();
    expect(store.get(selectedMetricKeyAtom)).toEqual({
      serviceName: "api/worker",
      name: "cpu.usage",
    });
    act(() => store.set(activeTabAtom, "logs"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/logs"));
    expect(await screen.findByText("Log route")).toBeDefined();
    act(() => store.set(activeTabAtom, "metrics"));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/metrics/api%2Fworker/cpu.usage"),
    );
  });

  it("does not navigate or reset state when the home link is modifier-clicked", async () => {
    await show("/traces/abc?q=checkout");
    const link = await screen.findByRole("link", { name: "otelop" });
    expect(link.getAttribute("href")).toBe("/");
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(router.state.location.pathname).toBe("/traces/abc");
    expect(store.get(selectedTraceIdAtom)).toBe("abc");
  });

  it("does not change the active selection when preloading another route", async () => {
    await router.navigate({ href: "/traces/abc" });
    await router.preloadRoute({ to: "/logs" });
    expect(store.get(activeTabAtom)).toBe("traces");
    expect(store.get(selectedTraceIdAtom)).toBe("abc");
  });
});
