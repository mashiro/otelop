import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { createStore, Provider } from "jotai";
import { useWebSocket } from "@/hooks/use-websocket";
import { createAppRouter } from "./router";

vi.mock("@/lib/graphql", () => ({ gqlClient: { request: async () => ({ trace: null }) } }));
vi.mock("@/hooks/use-initial-load", () => ({
  useInitialLoad: () => {},
  initialLoadOptions: { queryKey: ["router-test-bootstrap"], queryFn: async () => ({}) },
}));
vi.mock("@/hooks/use-websocket", () => ({ useWebSocket: vi.fn() }));
vi.mock("@/hooks/use-theme", () => ({ useThemeSync: () => {} }));
vi.mock("./components/traces/trace-list", () => ({ TraceList: () => <p>Trace route</p> }));
vi.mock("./components/logs/log-list", () => ({ LogList: () => <p>Log route</p> }));
vi.mock("./components/metrics/metric-list", () => ({ MetricList: () => <p>Metric route</p> }));
let router: ReturnType<typeof createAppRouter>;
beforeEach(async () => {
  router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }), createStore());
  await router.load();
});
async function show(href: string) {
  await router.navigate({ href });
  render(
    <Provider store={router.options.context.store}>
      <RouterProvider router={router} />
    </Provider>,
  );
}

describe("application routing", () => {
  it("resets URL state with the home Link and restores it on back/forward", async () => {
    const href =
      "/traces/abc?range=6h&q=checkout&filter=service_name%3Aapi&filter=status_code%3Aerror#detail";
    await show(href);
    expect(await screen.findByText("Trace route")).toBeDefined();
    expect(router.state.matches.at(-1)?.params).toEqual({ traceId: "abc" });
    expect(fireEvent.click(screen.getByRole("link", { name: "otelop" }))).toBe(false);
    await waitFor(() => expect(router.state.location.href).toBe("/"));
    expect(router.state.location.search).toEqual({});
    act(() => router.history.back());
    await waitFor(() => expect(router.state.location.href).toBe(href));
    expect(router.state.location.search).toMatchObject({
      q: "checkout",
      range: "6h",
      filter: ["service_name:api", "status_code:error"],
    });
    act(() => router.history.forward());
    await waitFor(() => expect(router.state.location.href).toBe("/"));
  });
  it("remembers each tab's destination, including encoded metric params and search", async () => {
    await show("/metrics/api%2Fworker/cpu.usage?range=24h&q=cpu");
    expect(await screen.findByText("Metric route")).toBeDefined();
    expect(router.state.matches.at(-1)?.params).toEqual({
      serviceName: "api/worker",
      name: "cpu.usage",
    });
    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    await screen.findByText("Log route");
    expect(router.state.location.pathname).toBe("/logs");
    fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
    await screen.findByText("Metric route");
    expect(router.state.location.pathname).toBe("/metrics/api%2Fworker/cpu.usage");
    expect(router.state.location.search).toMatchObject({ q: "cpu", range: "24h" });
  });
  it("shares the event window between traces and logs without sharing their filters", async () => {
    await show("/traces?range=6h&q=checkout");
    await screen.findByText("Trace route");
    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    await screen.findByText("Log route");
    expect(router.state.location.search).toEqual({ range: "6h" });
    await act(async () => {
      await router.navigate({ to: ".", search: { range: "30m", q: "failed" } });
    });
    fireEvent.click(screen.getByRole("tab", { name: "Traces" }));
    await screen.findByText("Trace route");
    expect(router.state.location.search).toMatchObject({ range: "30m", q: "checkout" });
  });
  it("remembers home as the traces destination when switching tabs", async () => {
    await show("/?q=checkout");
    await screen.findByText("Trace route");
    fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
    await screen.findByText("Metric route");
    fireEvent.click(screen.getByRole("tab", { name: "Traces" }));
    await screen.findByText("Trace route");
    expect(router.state.location.pathname).toBe("/");
    expect(router.state.location.search).toMatchObject({ q: "checkout" });
  });
  it("remembers a span destination when switching tabs", async () => {
    await show("/traces/abc/spans/span1?q=checkout");
    await screen.findByText("Trace route");
    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    await screen.findByText("Log route");
    fireEvent.click(screen.getByRole("tab", { name: "Traces" }));
    await screen.findByText("Trace route");
    expect(router.state.location.pathname).toBe("/traces/abc/spans/span1");
    expect(router.state.location.search).toMatchObject({ q: "checkout" });
  });
  it("remembers a log destination when switching tabs", async () => {
    await show("/logs/log1?q=checkout");
    await screen.findByText("Log route");
    fireEvent.click(screen.getByRole("tab", { name: "Traces" }));
    await screen.findByText("Trace route");
    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    await screen.findByText("Log route");
    expect(router.state.location.pathname).toBe("/logs/log1");
    expect(router.state.location.search).toMatchObject({ q: "checkout" });
  });
  it("keeps the shared event window unaffected by metrics searches", async () => {
    await show("/traces?range=6h&q=checkout");
    await screen.findByText("Trace route");
    await act(async () => {
      await router.navigate({
        to: "/metrics/$serviceName/$name",
        params: { serviceName: "api/worker", name: "cpu.usage" },
        search: { range: "24h", q: "cpu" },
      });
    });
    await screen.findByText("Metric route");
    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    await screen.findByText("Log route");
    expect(router.state.location.search).toMatchObject({ range: "6h" });
  });
  it("leaves modifier-click behavior to Link", async () => {
    await show("/traces/abc?q=checkout");
    const link = await screen.findByRole("link", { name: "otelop" });
    expect(link.getAttribute("href")).toBe("/");
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(router.state.location.pathname).toBe("/traces/abc");
  });
  it("does not alter tab bookmarks or the active route during preload", async () => {
    await router.navigate({ to: "/traces/$traceId", params: { traceId: "abc" } });
    await router.preloadRoute({ to: "/logs" });
    expect(router.state.location.pathname).toBe("/traces/abc");
    expect(router.options.context.tabHistory.destinations.logs).toBeUndefined();
  });
  it("closes an oversized trace removed by the backend while preserving its search", async () => {
    await show("/traces/oversized?q=checkout");
    await screen.findByText("Trace route");
    const onTraceRemoved = vi.mocked(useWebSocket).mock.calls.at(-1)?.[0];
    expect(onTraceRemoved).toBeDefined();
    await act(async () => onTraceRemoved?.("different-trace"));
    expect(router.state.location.pathname).toBe("/traces/oversized");
    await act(async () => onTraceRemoved?.("oversized"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/traces"));
    expect(router.state.location.search.q).toBe("checkout");
  });
});
