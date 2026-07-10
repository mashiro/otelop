import { describe, it, expect, beforeEach } from "vitest";
import { createStore } from "jotai";
import {
  activeTabAtom,
  applyLocationAtom,
  buildPath,
  parsePath,
  selectedLogIdAtom,
  selectedMetricKeyAtom,
  selectedTraceIdAtom,
} from "./navigation";

describe("parsePath", () => {
  it("maps the root path to traces with no selection", () => {
    expect(parsePath("/")).toEqual({ tab: "traces", traceId: null, metricKey: null, logId: null });
  });

  it("maps signal paths to their tabs", () => {
    expect(parsePath("/traces").tab).toBe("traces");
    expect(parsePath("/metrics").tab).toBe("metrics");
    expect(parsePath("/logs").tab).toBe("logs");
  });

  it("tolerates trailing segments and slashes", () => {
    expect(parsePath("/metrics/")).toEqual({
      tab: "metrics",
      traceId: null,
      metricKey: null,
      logId: null,
    });
  });

  it("falls back to traces for unknown paths", () => {
    expect(parsePath("/unknown").tab).toBe("traces");
  });

  it("extracts a decoded traceId under /traces", () => {
    expect(parsePath("/traces/abc123")).toEqual({
      tab: "traces",
      traceId: "abc123",
      metricKey: null,
      logId: null,
    });
  });

  it("decodes an encoded traceId", () => {
    expect(parsePath("/traces/a%2Fb").traceId).toBe("a/b");
  });

  it("ignores a trailing segment on other tabs", () => {
    expect(parsePath("/metrics/svc").metricKey).toBeNull();
    expect(parsePath("/traces/whatever").metricKey).toBeNull();
    expect(parsePath("/logs/whatever").traceId).toBeNull();
    expect(parsePath("/logs/whatever").metricKey).toBeNull();
  });

  it("extracts a decoded metricKey only when both segments are present", () => {
    expect(parsePath("/metrics/svc/cpu")).toEqual({
      tab: "metrics",
      traceId: null,
      metricKey: { serviceName: "svc", name: "cpu" },
      logId: null,
    });
  });

  it("decodes encoded metricKey segments", () => {
    const parsed = parsePath("/metrics/svc%2Fwith%20slash/cpu.usage");
    expect(parsed.metricKey).toEqual({ serviceName: "svc/with slash", name: "cpu.usage" });
  });

  it("extracts a decoded logId under /logs", () => {
    expect(parsePath("/logs/log-1")).toEqual({
      tab: "logs",
      traceId: null,
      metricKey: null,
      logId: "log-1",
    });
  });

  it("decodes an encoded logId", () => {
    expect(parsePath("/logs/a%2Fb").logId).toBe("a/b");
  });
});

describe("buildPath", () => {
  it("builds a bare tab path with no selection", () => {
    expect(buildPath({ tab: "traces", traceId: null, metricKey: null, logId: null })).toBe(
      "/traces",
    );
    expect(buildPath({ tab: "metrics", traceId: null, metricKey: null, logId: null })).toBe(
      "/metrics",
    );
    expect(buildPath({ tab: "logs", traceId: null, metricKey: null, logId: null })).toBe("/logs");
  });

  it("builds a trace detail path, encoding the traceId", () => {
    expect(buildPath({ tab: "traces", traceId: "a/b", metricKey: null, logId: null })).toBe(
      "/traces/a%2Fb",
    );
  });

  it("builds a metric detail path, encoding both segments", () => {
    expect(
      buildPath({
        tab: "metrics",
        traceId: null,
        metricKey: { serviceName: "svc/with slash", name: "cpu.usage" },
        logId: null,
      }),
    ).toBe("/metrics/svc%2Fwith%20slash/cpu.usage");
  });

  it("builds a log detail path, encoding the logId", () => {
    expect(buildPath({ tab: "logs", traceId: null, metricKey: null, logId: "a/b" })).toBe(
      "/logs/a%2Fb",
    );
  });

  it("ignores a traceId when the tab is not traces", () => {
    expect(buildPath({ tab: "metrics", traceId: "abc", metricKey: null, logId: null })).toBe(
      "/metrics",
    );
  });

  it("ignores a metricKey when the tab is not metrics", () => {
    expect(
      buildPath({
        tab: "traces",
        traceId: null,
        metricKey: { serviceName: "svc", name: "cpu" },
        logId: null,
      }),
    ).toBe("/traces");
  });

  it("ignores a logId when the tab is not logs", () => {
    expect(buildPath({ tab: "traces", traceId: null, metricKey: null, logId: "l1" })).toBe(
      "/traces",
    );
  });

  it("round-trips through parsePath, including characters needing encoding", () => {
    const path = buildPath({
      tab: "metrics",
      traceId: null,
      metricKey: { serviceName: "svc/with slash", name: "cpu.usage" },
      logId: null,
    });
    expect(parsePath(path)).toEqual({
      tab: "metrics",
      traceId: null,
      metricKey: { serviceName: "svc/with slash", name: "cpu.usage" },
      logId: null,
    });
  });

  it("round-trips a logId through parsePath", () => {
    const path = buildPath({ tab: "logs", traceId: null, metricKey: null, logId: "a/b" });
    expect(parsePath(path)).toEqual({ tab: "logs", traceId: null, metricKey: null, logId: "a/b" });
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

  it("includes the selected log when returning to the logs tab", () => {
    const store = createStore();
    store.set(activeTabAtom, "logs");
    store.set(selectedLogIdAtom, "log-1");
    store.set(activeTabAtom, "metrics");
    store.set(activeTabAtom, "logs");
    expect(window.location.pathname).toBe("/logs/log-1");
  });
});

describe("selectedTraceIdAtom / selectedMetricKeyAtom / selectedLogIdAtom (write-through)", () => {
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

  it("pushes the URL when the logId changes", () => {
    const store = createStore();
    store.set(activeTabAtom, "logs");
    store.set(selectedLogIdAtom, "log-1");
    expect(window.location.pathname).toBe("/logs/log-1");
  });

  it("does not push when set to the same logId", () => {
    const store = createStore();
    store.set(activeTabAtom, "logs");
    store.set(selectedLogIdAtom, "log-1");
    window.history.replaceState(null, "", "/somewhere-else");
    store.set(selectedLogIdAtom, "log-1");
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

  it("applies the tab and, for logs, the selected logId", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/logs/log-1");
    expect(store.get(activeTabAtom)).toBe("logs");
    expect(store.get(selectedLogIdAtom)).toBe("log-1");
  });

  it("keeps the traceId selection when switching to a different tab", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/traces/t1");
    store.set(applyLocationAtom, "/metrics/svc/cpu");
    expect(store.get(activeTabAtom)).toBe("metrics");
    expect(store.get(selectedMetricKeyAtom)).toEqual({ serviceName: "svc", name: "cpu" });
    expect(store.get(selectedTraceIdAtom)).toBe("t1");
  });

  it("keeps the logId selection when switching to a different tab", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/logs/log-1");
    store.set(applyLocationAtom, "/metrics/svc/cpu");
    expect(store.get(activeTabAtom)).toBe("metrics");
    expect(store.get(selectedLogIdAtom)).toBe("log-1");
  });

  it("clears the traceId when the applied traces path has no selection", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/traces/t1");
    store.set(applyLocationAtom, "/traces");
    expect(store.get(selectedTraceIdAtom)).toBeNull();
  });

  it("clears the logId when the applied logs path has no selection", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/logs/log-1");
    store.set(applyLocationAtom, "/logs");
    expect(store.get(selectedLogIdAtom)).toBeNull();
  });

  it("does not push to history", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/traces/t1");
    expect(window.location.pathname).toBe("/");
  });
});
