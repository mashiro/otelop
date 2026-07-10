import { describe, it, expect, beforeEach } from "vitest";
import { createStore } from "jotai";
import {
  activeTabAtom,
  applyLocationAtom,
  buildPath,
  parsePath,
  selectedMetricKeyAtom,
  selectedTraceIdAtom,
} from "./navigation";

describe("parsePath", () => {
  it("maps the root path to traces with no selection", () => {
    expect(parsePath("/")).toEqual({ tab: "traces", traceId: null, metricKey: null });
  });

  it("maps signal paths to their tabs", () => {
    expect(parsePath("/traces").tab).toBe("traces");
    expect(parsePath("/metrics").tab).toBe("metrics");
    expect(parsePath("/logs").tab).toBe("logs");
  });

  it("tolerates trailing segments and slashes", () => {
    expect(parsePath("/metrics/")).toEqual({ tab: "metrics", traceId: null, metricKey: null });
  });

  it("falls back to traces for unknown paths", () => {
    expect(parsePath("/unknown").tab).toBe("traces");
  });

  it("extracts a decoded traceId under /traces", () => {
    expect(parsePath("/traces/abc123")).toEqual({
      tab: "traces",
      traceId: "abc123",
      metricKey: null,
    });
  });

  it("decodes an encoded traceId", () => {
    expect(parsePath("/traces/a%2Fb").traceId).toBe("a/b");
  });

  it("ignores a trailing segment on other tabs", () => {
    expect(parsePath("/metrics/svc").metricKey).toBeNull();
    expect(parsePath("/logs/whatever").traceId).toBeNull();
  });

  it("extracts a decoded metricKey only when both segments are present", () => {
    expect(parsePath("/metrics/svc/cpu")).toEqual({
      tab: "metrics",
      traceId: null,
      metricKey: { serviceName: "svc", name: "cpu" },
    });
  });

  it("decodes encoded metricKey segments", () => {
    const parsed = parsePath("/metrics/svc%2Fwith%20slash/cpu.usage");
    expect(parsed.metricKey).toEqual({ serviceName: "svc/with slash", name: "cpu.usage" });
  });
});

describe("buildPath", () => {
  it("builds a bare tab path with no selection", () => {
    expect(buildPath("traces", null, null)).toBe("/traces");
    expect(buildPath("metrics", null, null)).toBe("/metrics");
    expect(buildPath("logs", null, null)).toBe("/logs");
  });

  it("builds a trace detail path, encoding the traceId", () => {
    expect(buildPath("traces", "a/b", null)).toBe("/traces/a%2Fb");
  });

  it("builds a metric detail path, encoding both segments", () => {
    expect(buildPath("metrics", null, { serviceName: "svc/with slash", name: "cpu.usage" })).toBe(
      "/metrics/svc%2Fwith%20slash/cpu.usage",
    );
  });

  it("ignores a traceId when the tab is not traces", () => {
    expect(buildPath("metrics", "abc", null)).toBe("/metrics");
  });

  it("ignores a metricKey when the tab is not metrics", () => {
    expect(buildPath("traces", null, { serviceName: "svc", name: "cpu" })).toBe("/traces");
  });

  it("round-trips through parsePath, including characters needing encoding", () => {
    const path = buildPath("metrics", null, { serviceName: "svc/with slash", name: "cpu.usage" });
    expect(parsePath(path)).toEqual({
      tab: "metrics",
      traceId: null,
      metricKey: { serviceName: "svc/with slash", name: "cpu.usage" },
    });
  });
});

describe("activeTabAtom", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("pushes the tab path to history on change", () => {
    const store = createStore();
    store.set(activeTabAtom, "metrics");
    expect(store.get(activeTabAtom)).toBe("metrics");
    expect(window.location.pathname).toBe("/metrics");
  });

  it("does not push a new URL when the tab is unchanged", () => {
    const store = createStore();
    store.set(activeTabAtom, "metrics");
    window.history.replaceState(null, "", "/somewhere-else");
    store.set(activeTabAtom, "metrics");
    expect(window.location.pathname).toBe("/somewhere-else");
  });

  it("follows browser back/forward via applyLocationAtom", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/logs");
    window.history.replaceState(null, "", "/metrics");
    store.set(applyLocationAtom, window.location.pathname);
    expect(store.get(activeTabAtom)).toBe("metrics");
  });

  it("includes the selected trace when returning to the traces tab", () => {
    const store = createStore();
    store.set(selectedTraceIdAtom, "t1");
    store.set(activeTabAtom, "metrics");
    store.set(activeTabAtom, "traces");
    expect(window.location.pathname).toBe("/traces/t1");
  });
});

describe("selectedTraceIdAtom / selectedMetricKeyAtom (write-through)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("pushes the URL when the traceId changes", () => {
    const store = createStore();
    store.set(selectedTraceIdAtom, "t1");
    expect(window.location.pathname).toBe("/traces/t1");
  });

  it("does not push when set to the same traceId", () => {
    const store = createStore();
    store.set(selectedTraceIdAtom, "t1");
    window.history.replaceState(null, "", "/somewhere-else");
    store.set(selectedTraceIdAtom, "t1");
    expect(window.location.pathname).toBe("/somewhere-else");
  });

  it("pushes the URL when the metricKey changes", () => {
    const store = createStore();
    store.set(activeTabAtom, "metrics");
    store.set(selectedMetricKeyAtom, { serviceName: "svc", name: "cpu" });
    expect(window.location.pathname).toBe("/metrics/svc/cpu");
  });

  it("does not push when set to an equal metricKey", () => {
    const store = createStore();
    store.set(activeTabAtom, "metrics");
    store.set(selectedMetricKeyAtom, { serviceName: "svc", name: "cpu" });
    window.history.replaceState(null, "", "/somewhere-else");
    store.set(selectedMetricKeyAtom, { serviceName: "svc", name: "cpu" });
    expect(window.location.pathname).toBe("/somewhere-else");
  });
});

describe("applyLocationAtom", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("applies the tab and, for traces, the selected traceId", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/traces/t1");
    expect(store.get(activeTabAtom)).toBe("traces");
    expect(store.get(selectedTraceIdAtom)).toBe("t1");
  });

  it("keeps the traceId selection when switching to a different tab", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/traces/t1");
    store.set(applyLocationAtom, "/metrics/svc/cpu");
    expect(store.get(activeTabAtom)).toBe("metrics");
    expect(store.get(selectedMetricKeyAtom)).toEqual({ serviceName: "svc", name: "cpu" });
    expect(store.get(selectedTraceIdAtom)).toBe("t1");
  });

  it("clears the traceId when the applied traces path has no selection", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/traces/t1");
    store.set(applyLocationAtom, "/traces");
    expect(store.get(selectedTraceIdAtom)).toBeNull();
  });

  it("does not push to history", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/traces/t1");
    expect(window.location.pathname).toBe("/");
  });
});
