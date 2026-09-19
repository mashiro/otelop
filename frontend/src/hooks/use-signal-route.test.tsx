import { describe, it, expect } from "vite-plus/test";
import { act, renderHook } from "@testing-library/react";
import { createStore } from "jotai";
import { createTestRouter } from "@/test/router";
import {
  useSignalQuery,
  useTimeWindow,
  useTraceSelection,
  useMetricSelection,
  useMetricQuery,
  useLogSelection,
  useRelatedSignals,
} from "./use-signal-route";
import { tracesAtom, metricsAtom, logsAtom } from "@/stores/telemetry";
import { makeTrace, makeMetric, makeLog } from "@/test/factories";
import { draftTerm } from "@/lib/log-filter";

async function setup(href = "/traces") {
  const store = createStore();
  const routing = await createTestRouter(href, store);
  return { store, ...routing };
}

describe("URL-backed signal state", () => {
  it("restores selections from Router params as buffered data arrives", async () => {
    const { store, router, wrapper } = await setup("/traces/outside-page");
    const { result } = renderHook(
      () => ({ ...useTraceSelection(), ...useMetricSelection(), ...useLogSelection() }),
      { wrapper },
    );
    expect(result.current.traceId).toBe("outside-page");
    expect(result.current.trace).toBeNull();
    act(() => store.set(tracesAtom, [makeTrace({ traceId: "outside-page" })]));
    expect(result.current.trace?.traceId).toBe("outside-page");
    await act(async () => {
      await result.current.selectTrace(null);
    });
    expect(result.current.traceId).toBeNull();
    expect(router.state.location.pathname).toBe("/traces");
    const metric = makeMetric({ serviceName: "api/worker & 日本語", name: "cpu/usage" });
    act(() => store.set(metricsAtom, [metric]));
    await act(async () => {
      await result.current.selectMetric(metric);
    });
    expect(result.current.metric).toBe(metric);
    expect(router.state.location.pathname).toContain("api%2Fworker");
    expect(router.state.location.pathname).toContain("cpu%2Fusage");
    await act(async () => {
      await result.current.selectMetric(null);
    });
    expect(result.current.metric).toBeNull();
    const log = makeLog({ id: "log/1" });
    act(() => store.set(logsAtom, [log]));
    await act(async () => {
      await result.current.selectLog(log);
    });
    expect(result.current.log).toBe(log);
    expect(router.state.location.pathname).toBe("/logs/log%2F1");
  });

  it("round-trips the metrics search, clearing q while preserving other params", async () => {
    const { router, wrapper } = await setup("/metrics?range=6h");
    const { result } = renderHook(() => useMetricQuery(), { wrapper });
    expect(result.current.search).toBe("");
    await act(async () => {
      expect(result.current.setSearch("cpu")).toBe("cpu");
    });
    expect(result.current.search).toBe("cpu");
    expect(router.state.location.search.range).toBe("6h");
    await act(async () => {
      expect(result.current.setSearch("")).toBe("");
    });
    expect(result.current.search).toBe("");
    expect(router.state.location.search.q).toBeUndefined();
    expect(router.state.location.search.range).toBe("6h");
  });

  it.each(["traces", "logs"] as const)(
    "round-trips %s filters, text, selection and nanosecond bounds",
    async (signal) => {
      const { router, wrapper } = await setup(`/${signal}/abc`);
      const { result } = renderHook(
        () => ({ query: useSignalQuery(signal), window: useTimeWindow() }),
        { wrapper },
      );
      await act(async () => {
        await result.current.window[1]({
          mode: "fixed",
          from: "2026-09-14T00:00:00.123456789Z",
          to: "2026-09-14T00:01:00Z",
        });
      });
      await act(async () => {
        result.current.query.setText('diff & + # 日本語 attributes.cmd:"a&b"');
      });
      expect(result.current.query.state.text).toBe("diff & + # 日本語");
      expect(result.current.query.state.filters).toHaveLength(1);
      await act(async () => {
        await result.current.query.setState((state) => ({
          ...state,
          filters: state.filters.map((f) => ({ ...f, enabled: false })),
        }));
      });
      const href = router.state.location.href;
      await act(async () => {
        await router.navigate({ to: "/", search: {} });
      });
      expect(result.current.query.state).toEqual({ text: "", filters: [] });
      await act(async () => {
        await router.navigate({ href });
      });
      expect(result.current.query.state).toMatchObject({
        text: "diff & + # 日本語",
        filters: [{ enabled: false, value: "a&b" }],
      });
      expect(result.current.window[0]).toEqual({
        mode: "fixed",
        from: "2026-09-14T00:00:00.123456789Z",
        to: "2026-09-14T00:01:00Z",
      });
      expect(router.state.location.pathname).toBe(`/${signal}/abc`);
      await act(async () => {
        await result.current.window[1]({ mode: "live", range: "1h" });
      });
      expect(router.state.location.search.from).toBeUndefined();
      expect(router.state.location.search.to).toBeUndefined();
      expect(router.state.location.search.range).toBeUndefined();
    },
  );

  it("deduplicates detail filters, reenables disabled conditions, and clears filter-only text", async () => {
    const { wrapper } = await setup("/logs");
    const { result } = renderHook(() => useSignalQuery("logs"), { wrapper });
    const term = draftTerm({ key: "trace_id", operator: "is", value: "abc" });
    await act(async () => {
      await result.current.addFilter(term);
    });
    await act(async () => {
      await result.current.addFilter(term);
    });
    expect(result.current.state.filters).toHaveLength(1);
    await act(async () => {
      await result.current.setState((state) => ({
        ...state,
        filters: state.filters.map((f) => ({ ...f, enabled: false })),
      }));
    });
    await act(async () => {
      await result.current.addFilter(term);
    });
    expect(result.current.state.filters).toMatchObject([{ enabled: true }]);
    await act(async () => {
      expect(result.current.setText('attributes.method:"GET"')).toBe("");
    });
    expect(result.current.state.text).toBe("");
    expect(result.current.state.filters).toHaveLength(2);
  });

  it("opens related logs in one history entry, retaining filters and the current window", async () => {
    const { router, wrapper } = await setup(
      "/logs?filter=severity_text%3AERROR&disabled_filter=trace_id%3A%22abc%22",
    );
    await router.navigate({
      to: "/traces/$traceId",
      params: { traceId: "abc" },
      search: { range: "6h" },
    });
    const { result } = renderHook(
      () => ({ ...useRelatedSignals(), query: useSignalQuery("logs"), ...useLogSelection() }),
      { wrapper },
    );
    const length = router.history.length;
    await act(async () => {
      await result.current.navigateToLogs("abc");
    });
    expect(router.history.length).toBe(length + 1);
    expect(router.state.location.pathname).toBe("/logs");
    expect(router.state.location.search.range).toBe("6h");
    expect(result.current.query.state.filters).toMatchObject([
      { enabled: true },
      { enabled: true },
    ]);
    expect(result.current.query.search).toBe('severity_text:ERROR trace_id:"abc"');
    await act(async () => {
      await result.current.selectLog(makeLog({ id: "focused-log" }));
    });
    await act(async () => {
      await result.current.showSurroundingLogs({
        mode: "fixed",
        from: "2026-09-14T00:00:00Z",
        to: "2026-09-14T00:01:00Z",
      });
    });
    expect(result.current.query.state).toEqual({ text: "", filters: [] });
    expect(router.state.location.pathname).toBe("/logs/focused-log");
    expect(router.state.location.search.from).toBe("2026-09-14T00:00:00Z");
  });
});
