import { describe, it, expect, beforeEach } from "vitest";
import { createStore } from "jotai";
import { DEFAULT_CHART_TIME_RANGE } from "@/lib/chart-time-range";
import {
  activeTabAtom,
  applyLocationAtom,
  buildPath,
  eventTimeWindowAtom,
  metricTimeWindowAtom,
  parsePath,
  selectedLogIdAtom,
  selectedLogRangeAtom,
  selectedMetricKeyAtom,
  selectedMetricRangeAtom,
  selectedTraceIdAtom,
  selectedTraceRangeAtom,
} from "./navigation";

describe("parsePath", () => {
  it("maps the root path to traces with no selection", () => {
    expect(parsePath("/")).toEqual({
      tab: "traces",
      traceId: null,
      metricKey: null,
      logId: null,
      metricRange: DEFAULT_CHART_TIME_RANGE,
      traceRange: DEFAULT_CHART_TIME_RANGE,
      logRange: DEFAULT_CHART_TIME_RANGE,
    });
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
      metricRange: DEFAULT_CHART_TIME_RANGE,
      traceRange: DEFAULT_CHART_TIME_RANGE,
      logRange: DEFAULT_CHART_TIME_RANGE,
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
      metricRange: DEFAULT_CHART_TIME_RANGE,
      traceRange: DEFAULT_CHART_TIME_RANGE,
      logRange: DEFAULT_CHART_TIME_RANGE,
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
      metricRange: DEFAULT_CHART_TIME_RANGE,
      traceRange: DEFAULT_CHART_TIME_RANGE,
      logRange: DEFAULT_CHART_TIME_RANGE,
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
      metricRange: DEFAULT_CHART_TIME_RANGE,
      traceRange: DEFAULT_CHART_TIME_RANGE,
      logRange: DEFAULT_CHART_TIME_RANGE,
    });
  });

  it("decodes an encoded logId", () => {
    expect(parsePath("/logs/a%2Fb").logId).toBe("a/b");
  });

  describe("metric range query param", () => {
    it("reads a valid range param on a metrics path", () => {
      expect(parsePath("/metrics/svc/cpu?range=6h").metricRange).toBe("6h");
    });

    it("falls back to the default when the param is absent", () => {
      expect(parsePath("/metrics/svc/cpu").metricRange).toBe(DEFAULT_CHART_TIME_RANGE);
    });

    it("falls back to the default silently when the param is invalid", () => {
      expect(parsePath("/metrics/svc/cpu?range=7d").metricRange).toBe(DEFAULT_CHART_TIME_RANGE);
      expect(parsePath("/metrics/svc/cpu?range=bogus").metricRange).toBe(DEFAULT_CHART_TIME_RANGE);
      expect(parsePath("/metrics/svc/cpu?range=").metricRange).toBe(DEFAULT_CHART_TIME_RANGE);
    });

    it("ignores the range param outside the metrics tab", () => {
      expect(parsePath("/traces/t1?range=6h").metricRange).toBe(DEFAULT_CHART_TIME_RANGE);
      expect(parsePath("/logs/log-1?range=6h").metricRange).toBe(DEFAULT_CHART_TIME_RANGE);
    });
  });

  describe("trace range query param", () => {
    it("reads a valid range param on a traces path", () => {
      expect(parsePath("/traces?range=6h").traceRange).toBe("6h");
      expect(parsePath("/traces/t1?range=6h").traceRange).toBe("6h");
    });

    it("falls back to the default when the param is absent", () => {
      expect(parsePath("/traces").traceRange).toBe(DEFAULT_CHART_TIME_RANGE);
    });

    it("falls back to the default silently when the param is invalid", () => {
      expect(parsePath("/traces?range=7d").traceRange).toBe(DEFAULT_CHART_TIME_RANGE);
      expect(parsePath("/traces?range=bogus").traceRange).toBe(DEFAULT_CHART_TIME_RANGE);
    });

    it("ignores the range param outside the traces tab", () => {
      expect(parsePath("/metrics/svc/cpu?range=6h").traceRange).toBe(DEFAULT_CHART_TIME_RANGE);
      expect(parsePath("/logs/log-1?range=6h").traceRange).toBe(DEFAULT_CHART_TIME_RANGE);
    });
  });

  describe("log range query param", () => {
    it("reads a valid range param on a logs path", () => {
      expect(parsePath("/logs?range=24h").logRange).toBe("24h");
      expect(parsePath("/logs/log-1?range=24h").logRange).toBe("24h");
    });

    it("falls back to the default when the param is absent", () => {
      expect(parsePath("/logs").logRange).toBe(DEFAULT_CHART_TIME_RANGE);
    });

    it("falls back to the default silently when the param is invalid", () => {
      expect(parsePath("/logs?range=7d").logRange).toBe(DEFAULT_CHART_TIME_RANGE);
      expect(parsePath("/logs?range=bogus").logRange).toBe(DEFAULT_CHART_TIME_RANGE);
    });

    it("ignores the range param outside the logs tab", () => {
      expect(parsePath("/metrics/svc/cpu?range=24h").logRange).toBe(DEFAULT_CHART_TIME_RANGE);
      expect(parsePath("/traces/t1?range=24h").logRange).toBe(DEFAULT_CHART_TIME_RANGE);
    });
  });
});

describe("buildPath", () => {
  it("builds a bare tab path with no selection", () => {
    expect(
      buildPath({
        tab: "traces",
        traceId: null,
        metricKey: null,
        logId: null,
        metricRange: DEFAULT_CHART_TIME_RANGE,
        traceRange: DEFAULT_CHART_TIME_RANGE,
        logRange: DEFAULT_CHART_TIME_RANGE,
      }),
    ).toBe("/traces");
    expect(
      buildPath({
        tab: "metrics",
        traceId: null,
        metricKey: null,
        logId: null,
        metricRange: DEFAULT_CHART_TIME_RANGE,
        traceRange: DEFAULT_CHART_TIME_RANGE,
        logRange: DEFAULT_CHART_TIME_RANGE,
      }),
    ).toBe("/metrics");
    expect(
      buildPath({
        tab: "logs",
        traceId: null,
        metricKey: null,
        logId: null,
        metricRange: DEFAULT_CHART_TIME_RANGE,
        traceRange: DEFAULT_CHART_TIME_RANGE,
        logRange: DEFAULT_CHART_TIME_RANGE,
      }),
    ).toBe("/logs");
  });

  it("builds a trace detail path, encoding the traceId", () => {
    expect(
      buildPath({
        tab: "traces",
        traceId: "a/b",
        metricKey: null,
        logId: null,
        metricRange: DEFAULT_CHART_TIME_RANGE,
        traceRange: DEFAULT_CHART_TIME_RANGE,
        logRange: DEFAULT_CHART_TIME_RANGE,
      }),
    ).toBe("/traces/a%2Fb");
  });

  it("builds a metric detail path, encoding both segments", () => {
    expect(
      buildPath({
        tab: "metrics",
        traceId: null,
        metricKey: { serviceName: "svc/with slash", name: "cpu.usage" },
        logId: null,
        metricRange: DEFAULT_CHART_TIME_RANGE,
        traceRange: DEFAULT_CHART_TIME_RANGE,
        logRange: DEFAULT_CHART_TIME_RANGE,
      }),
    ).toBe("/metrics/svc%2Fwith%20slash/cpu.usage");
  });

  it("builds a log detail path, encoding the logId", () => {
    expect(
      buildPath({
        tab: "logs",
        traceId: null,
        metricKey: null,
        logId: "a/b",
        metricRange: DEFAULT_CHART_TIME_RANGE,
        traceRange: DEFAULT_CHART_TIME_RANGE,
        logRange: DEFAULT_CHART_TIME_RANGE,
      }),
    ).toBe("/logs/a%2Fb");
  });

  it("ignores a traceId when the tab is not traces", () => {
    expect(
      buildPath({
        tab: "metrics",
        traceId: "abc",
        metricKey: null,
        logId: null,
        metricRange: DEFAULT_CHART_TIME_RANGE,
        traceRange: DEFAULT_CHART_TIME_RANGE,
        logRange: DEFAULT_CHART_TIME_RANGE,
      }),
    ).toBe("/metrics");
  });

  it("ignores a metricKey when the tab is not metrics", () => {
    expect(
      buildPath({
        tab: "traces",
        traceId: null,
        metricKey: { serviceName: "svc", name: "cpu" },
        logId: null,
        metricRange: DEFAULT_CHART_TIME_RANGE,
        traceRange: DEFAULT_CHART_TIME_RANGE,
        logRange: DEFAULT_CHART_TIME_RANGE,
      }),
    ).toBe("/traces");
  });

  it("ignores a logId when the tab is not logs", () => {
    expect(
      buildPath({
        tab: "traces",
        traceId: null,
        metricKey: null,
        logId: "l1",
        metricRange: DEFAULT_CHART_TIME_RANGE,
        traceRange: DEFAULT_CHART_TIME_RANGE,
        logRange: DEFAULT_CHART_TIME_RANGE,
      }),
    ).toBe("/traces");
  });

  it("round-trips through parsePath, including characters needing encoding", () => {
    const path = buildPath({
      tab: "metrics",
      traceId: null,
      metricKey: { serviceName: "svc/with slash", name: "cpu.usage" },
      logId: null,
      metricRange: DEFAULT_CHART_TIME_RANGE,
      traceRange: DEFAULT_CHART_TIME_RANGE,
      logRange: DEFAULT_CHART_TIME_RANGE,
    });
    expect(parsePath(path)).toEqual({
      tab: "metrics",
      traceId: null,
      metricKey: { serviceName: "svc/with slash", name: "cpu.usage" },
      logId: null,
      metricRange: DEFAULT_CHART_TIME_RANGE,
      traceRange: DEFAULT_CHART_TIME_RANGE,
      logRange: DEFAULT_CHART_TIME_RANGE,
    });
  });

  it("round-trips a logId through parsePath", () => {
    const path = buildPath({
      tab: "logs",
      traceId: null,
      metricKey: null,
      logId: "a/b",
      metricRange: DEFAULT_CHART_TIME_RANGE,
      traceRange: DEFAULT_CHART_TIME_RANGE,
      logRange: DEFAULT_CHART_TIME_RANGE,
    });
    expect(parsePath(path)).toEqual({
      tab: "logs",
      traceId: null,
      metricKey: null,
      logId: "a/b",
      metricRange: DEFAULT_CHART_TIME_RANGE,
      traceRange: DEFAULT_CHART_TIME_RANGE,
      logRange: DEFAULT_CHART_TIME_RANGE,
    });
  });

  describe("metric range query param", () => {
    it("elides the range param at the default", () => {
      expect(
        buildPath({
          tab: "metrics",
          traceId: null,
          metricKey: { serviceName: "svc", name: "cpu" },
          logId: null,
          metricRange: DEFAULT_CHART_TIME_RANGE,
          traceRange: DEFAULT_CHART_TIME_RANGE,
          logRange: DEFAULT_CHART_TIME_RANGE,
        }),
      ).toBe("/metrics/svc/cpu");
    });

    it("includes the range param when it differs from the default", () => {
      expect(
        buildPath({
          tab: "metrics",
          traceId: null,
          metricKey: { serviceName: "svc", name: "cpu" },
          logId: null,
          metricRange: "6h",
          traceRange: DEFAULT_CHART_TIME_RANGE,
          logRange: DEFAULT_CHART_TIME_RANGE,
        }),
      ).toBe("/metrics/svc/cpu?range=6h");
    });

    it("omits the range param when there is no metricKey, even if non-default", () => {
      expect(
        buildPath({
          tab: "metrics",
          traceId: null,
          metricKey: null,
          logId: null,
          metricRange: "6h",
          traceRange: DEFAULT_CHART_TIME_RANGE,
          logRange: DEFAULT_CHART_TIME_RANGE,
        }),
      ).toBe("/metrics");
    });

    it("round-trips a non-default range through parsePath", () => {
      const path = buildPath({
        tab: "metrics",
        traceId: null,
        metricKey: { serviceName: "svc", name: "cpu" },
        logId: null,
        metricRange: "24h",
        traceRange: DEFAULT_CHART_TIME_RANGE,
        logRange: DEFAULT_CHART_TIME_RANGE,
      });
      expect(parsePath(path)).toEqual({
        tab: "metrics",
        traceId: null,
        metricKey: { serviceName: "svc", name: "cpu" },
        logId: null,
        metricRange: "24h",
        traceRange: DEFAULT_CHART_TIME_RANGE,
        logRange: DEFAULT_CHART_TIME_RANGE,
      });
    });
  });

  describe("trace range query param", () => {
    it("elides the range param at the default, with or without a selected trace", () => {
      expect(
        buildPath({
          tab: "traces",
          traceId: null,
          metricKey: null,
          logId: null,
          metricRange: DEFAULT_CHART_TIME_RANGE,
          traceRange: DEFAULT_CHART_TIME_RANGE,
          logRange: DEFAULT_CHART_TIME_RANGE,
        }),
      ).toBe("/traces");
      expect(
        buildPath({
          tab: "traces",
          traceId: "t1",
          metricKey: null,
          logId: null,
          metricRange: DEFAULT_CHART_TIME_RANGE,
          traceRange: DEFAULT_CHART_TIME_RANGE,
          logRange: DEFAULT_CHART_TIME_RANGE,
        }),
      ).toBe("/traces/t1");
    });

    it("includes the range param on the bare list path when non-default", () => {
      expect(
        buildPath({
          tab: "traces",
          traceId: null,
          metricKey: null,
          logId: null,
          metricRange: DEFAULT_CHART_TIME_RANGE,
          traceRange: "6h",
          logRange: DEFAULT_CHART_TIME_RANGE,
        }),
      ).toBe("/traces?range=6h");
    });

    it("includes the range param alongside a selected trace when non-default", () => {
      expect(
        buildPath({
          tab: "traces",
          traceId: "t1",
          metricKey: null,
          logId: null,
          metricRange: DEFAULT_CHART_TIME_RANGE,
          traceRange: "6h",
          logRange: DEFAULT_CHART_TIME_RANGE,
        }),
      ).toBe("/traces/t1?range=6h");
    });

    it("round-trips a non-default range through parsePath", () => {
      const path = buildPath({
        tab: "traces",
        traceId: null,
        metricKey: null,
        logId: null,
        metricRange: DEFAULT_CHART_TIME_RANGE,
        traceRange: "24h",
        logRange: DEFAULT_CHART_TIME_RANGE,
      });
      expect(parsePath(path)).toEqual({
        tab: "traces",
        traceId: null,
        metricKey: null,
        logId: null,
        metricRange: DEFAULT_CHART_TIME_RANGE,
        traceRange: "24h",
        logRange: DEFAULT_CHART_TIME_RANGE,
      });
    });
  });

  describe("log range query param", () => {
    it("elides the range param at the default, with or without a selected log", () => {
      expect(
        buildPath({
          tab: "logs",
          traceId: null,
          metricKey: null,
          logId: null,
          metricRange: DEFAULT_CHART_TIME_RANGE,
          traceRange: DEFAULT_CHART_TIME_RANGE,
          logRange: DEFAULT_CHART_TIME_RANGE,
        }),
      ).toBe("/logs");
      expect(
        buildPath({
          tab: "logs",
          traceId: null,
          metricKey: null,
          logId: "log-1",
          metricRange: DEFAULT_CHART_TIME_RANGE,
          traceRange: DEFAULT_CHART_TIME_RANGE,
          logRange: DEFAULT_CHART_TIME_RANGE,
        }),
      ).toBe("/logs/log-1");
    });

    it("includes the range param on the bare list path when non-default", () => {
      expect(
        buildPath({
          tab: "logs",
          traceId: null,
          metricKey: null,
          logId: null,
          metricRange: DEFAULT_CHART_TIME_RANGE,
          traceRange: DEFAULT_CHART_TIME_RANGE,
          logRange: "30m",
        }),
      ).toBe("/logs?range=30m");
    });

    it("round-trips a non-default range through parsePath", () => {
      const path = buildPath({
        tab: "logs",
        traceId: null,
        metricKey: null,
        logId: "log-1",
        metricRange: DEFAULT_CHART_TIME_RANGE,
        traceRange: DEFAULT_CHART_TIME_RANGE,
        logRange: "30m",
      });
      expect(parsePath(path)).toEqual({
        tab: "logs",
        traceId: null,
        metricKey: null,
        logId: "log-1",
        metricRange: DEFAULT_CHART_TIME_RANGE,
        traceRange: DEFAULT_CHART_TIME_RANGE,
        logRange: "30m",
      });
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

describe("selectedMetricRangeAtom (write-through)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("pushes the range query param once a metric is selected", () => {
    const store = createStore();
    store.set(activeTabAtom, "metrics");
    store.set(selectedMetricKeyAtom, { serviceName: "svc", name: "cpu" });
    store.set(selectedMetricRangeAtom, "6h");
    expect(window.location.pathname + window.location.search).toBe("/metrics/svc/cpu?range=6h");
  });

  it("does not push when set to the same range", () => {
    const store = createStore();
    store.set(activeTabAtom, "metrics");
    store.set(selectedMetricKeyAtom, { serviceName: "svc", name: "cpu" });
    store.set(selectedMetricRangeAtom, "6h");
    window.history.replaceState(null, "", "/somewhere-else");
    store.set(selectedMetricRangeAtom, "6h");
    expect(window.location.pathname).toBe("/somewhere-else");
  });

  it("drops the query param entirely when set back to the default", () => {
    const store = createStore();
    store.set(activeTabAtom, "metrics");
    store.set(selectedMetricKeyAtom, { serviceName: "svc", name: "cpu" });
    store.set(selectedMetricRangeAtom, "6h");
    store.set(selectedMetricRangeAtom, DEFAULT_CHART_TIME_RANGE);
    expect(window.location.pathname + window.location.search).toBe("/metrics/svc/cpu");
  });
});

describe("selectedTraceRangeAtom (write-through)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("pushes the range query param on the bare traces list, no selection required", () => {
    const store = createStore();
    store.set(activeTabAtom, "traces");
    store.set(selectedTraceRangeAtom, "6h");
    expect(window.location.pathname + window.location.search).toBe("/traces?range=6h");
  });

  it("does not push when set to the same range", () => {
    const store = createStore();
    store.set(activeTabAtom, "traces");
    store.set(selectedTraceRangeAtom, "6h");
    window.history.replaceState(null, "", "/somewhere-else");
    store.set(selectedTraceRangeAtom, "6h");
    expect(window.location.pathname).toBe("/somewhere-else");
  });

  it("drops the query param entirely when set back to the default", () => {
    const store = createStore();
    store.set(activeTabAtom, "traces");
    store.set(selectedTraceRangeAtom, "6h");
    store.set(selectedTraceRangeAtom, DEFAULT_CHART_TIME_RANGE);
    expect(window.location.pathname + window.location.search).toBe("/traces");
  });
});

describe("eventTimeWindowAtom", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/traces");
  });

  it("shares a live range across traces and logs", () => {
    const store = createStore();
    store.set(selectedTraceRangeAtom, "6h");
    store.set(activeTabAtom, "logs");
    expect(store.get(selectedLogRangeAtom)).toBe("6h");
    expect(window.location.pathname + window.location.search).toBe("/logs?range=6h");
  });

  it("serializes and restores a fixed window", () => {
    const store = createStore();
    store.set(eventTimeWindowAtom, {
      mode: "fixed",
      from: "2026-07-12T01:00:00Z",
      to: "2026-07-12T02:00:00Z",
    });
    expect(window.location.search).toContain("from=2026-07-12T01%3A00%3A00Z");
    expect(window.location.search).toContain("to=2026-07-12T02%3A00%3A00Z");

    store.set(applyLocationAtom, window.location.pathname + window.location.search);
    expect(store.get(eventTimeWindowAtom)).toEqual({
      mode: "fixed",
      from: "2026-07-12T01:00:00Z",
      to: "2026-07-12T02:00:00Z",
    });
  });
});

describe("metricTimeWindowAtom", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/metrics/svc/cpu");
  });

  it("serializes and restores a fixed metric window", () => {
    const store = createStore();
    store.set(activeTabAtom, "metrics");
    store.set(selectedMetricKeyAtom, { serviceName: "svc", name: "cpu" });
    store.set(metricTimeWindowAtom, {
      mode: "fixed",
      from: "2026-07-12T01:00:00Z",
      to: "2026-07-12T02:00:00Z",
    });

    expect(window.location.pathname).toBe("/metrics/svc/cpu");
    expect(window.location.search).toContain("from=2026-07-12T01%3A00%3A00Z");
    expect(window.location.search).toContain("to=2026-07-12T02%3A00%3A00Z");

    store.set(applyLocationAtom, window.location.pathname + window.location.search);
    expect(store.get(metricTimeWindowAtom)).toEqual({
      mode: "fixed",
      from: "2026-07-12T01:00:00Z",
      to: "2026-07-12T02:00:00Z",
    });
  });

  it("returns to a live metric window when its range changes", () => {
    const store = createStore();
    store.set(activeTabAtom, "metrics");
    store.set(selectedMetricKeyAtom, { serviceName: "svc", name: "cpu" });
    store.set(metricTimeWindowAtom, {
      mode: "fixed",
      from: "2026-07-12T01:00:00Z",
      to: "2026-07-12T02:00:00Z",
    });

    store.set(selectedMetricRangeAtom, "6h");

    expect(store.get(metricTimeWindowAtom)).toEqual({ mode: "live", range: "6h" });
    expect(window.location.pathname + window.location.search).toBe("/metrics/svc/cpu?range=6h");
  });
});

describe("selectedLogRangeAtom (write-through)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("pushes the range query param on the bare logs list, no selection required", () => {
    const store = createStore();
    store.set(activeTabAtom, "logs");
    store.set(selectedLogRangeAtom, "24h");
    expect(window.location.pathname + window.location.search).toBe("/logs?range=24h");
  });

  it("does not push when set to the same range", () => {
    const store = createStore();
    store.set(activeTabAtom, "logs");
    store.set(selectedLogRangeAtom, "24h");
    window.history.replaceState(null, "", "/somewhere-else");
    store.set(selectedLogRangeAtom, "24h");
    expect(window.location.pathname).toBe("/somewhere-else");
  });

  it("drops the query param entirely when set back to the default", () => {
    const store = createStore();
    store.set(activeTabAtom, "logs");
    store.set(selectedLogRangeAtom, "24h");
    store.set(selectedLogRangeAtom, DEFAULT_CHART_TIME_RANGE);
    expect(window.location.pathname + window.location.search).toBe("/logs");
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

  describe("metric range query param", () => {
    it("applies a valid range from the URL", () => {
      const store = createStore();
      store.set(applyLocationAtom, "/metrics/svc/cpu?range=6h");
      expect(store.get(selectedMetricRangeAtom)).toBe("6h");
    });

    it("falls back to the default silently for an invalid range", () => {
      const store = createStore();
      store.set(applyLocationAtom, "/metrics/svc/cpu?range=bogus");
      expect(store.get(selectedMetricRangeAtom)).toBe(DEFAULT_CHART_TIME_RANGE);
    });

    it("resets to the default when returning to the metrics list (no range param)", () => {
      const store = createStore();
      store.set(applyLocationAtom, "/metrics/svc/cpu?range=6h");
      store.set(applyLocationAtom, "/metrics");
      expect(store.get(selectedMetricRangeAtom)).toBe(DEFAULT_CHART_TIME_RANGE);
    });
  });

  describe("trace range query param", () => {
    it("applies a valid range from the URL on the bare list path", () => {
      const store = createStore();
      store.set(applyLocationAtom, "/traces?range=6h");
      expect(store.get(selectedTraceRangeAtom)).toBe("6h");
    });

    it("falls back to the default silently for an invalid range", () => {
      const store = createStore();
      store.set(applyLocationAtom, "/traces?range=bogus");
      expect(store.get(selectedTraceRangeAtom)).toBe(DEFAULT_CHART_TIME_RANGE);
    });

    it("resets to the default when navigating away with no range param", () => {
      const store = createStore();
      store.set(applyLocationAtom, "/traces?range=6h");
      store.set(applyLocationAtom, "/traces");
      expect(store.get(selectedTraceRangeAtom)).toBe(DEFAULT_CHART_TIME_RANGE);
    });
  });

  describe("log range query param", () => {
    it("applies a valid range from the URL on the bare list path", () => {
      const store = createStore();
      store.set(applyLocationAtom, "/logs?range=30m");
      expect(store.get(selectedLogRangeAtom)).toBe("30m");
    });

    it("falls back to the default silently for an invalid range", () => {
      const store = createStore();
      store.set(applyLocationAtom, "/logs?range=bogus");
      expect(store.get(selectedLogRangeAtom)).toBe(DEFAULT_CHART_TIME_RANGE);
    });

    it("resets to the default when navigating away with no range param", () => {
      const store = createStore();
      store.set(applyLocationAtom, "/logs?range=30m");
      store.set(applyLocationAtom, "/logs");
      expect(store.get(selectedLogRangeAtom)).toBe(DEFAULT_CHART_TIME_RANGE);
    });
  });
});
