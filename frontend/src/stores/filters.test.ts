import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import { tracesAtom, metricsAtom, logsAtom, logTraceFilterAtom } from "./telemetry";
import {
  traceFiltersAtom,
  filteredTracesAtom,
  logFiltersAtom,
  filteredLogsAtom,
  metricFiltersAtom,
  filteredMetricsAtom,
} from "./filters";
import type { TraceData, MetricData, LogData, SpanData } from "@/types/telemetry";

function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  return {
    traceID: "t1",
    spanID: "s1",
    parentSpanID: "",
    name: "GET /api",
    kind: "Server",
    serviceName: "frontend",
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-01T00:00:01Z",
    duration: 1_000_000,
    statusCode: "Ok",
    statusMessage: "",
    attributes: {},
    events: [],
    resource: {},
    ...overrides,
  };
}

function makeTrace(overrides: Partial<TraceData> = {}): TraceData {
  return {
    traceID: "t1",
    spans: [makeSpan()],
    spanCount: 1,
    serviceName: "frontend",
    startTime: "2024-01-01T00:00:00Z",
    duration: 1_000_000,
    ...overrides,
  };
}

function makeLog(overrides: Partial<LogData> = {}): LogData {
  return {
    timestamp: "2024-01-01T00:00:00Z",
    severityText: "INFO",
    body: "request handled",
    traceID: "",
    spanID: "",
    serviceName: "frontend",
    attributes: {},
    resource: {},
    ...overrides,
  };
}

function makeMetric(overrides: Partial<MetricData> = {}): MetricData {
  return {
    name: "http.requests",
    type: "Sum",
    unit: "",
    description: "",
    serviceName: "frontend",
    dataPoints: [],
    receivedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("filteredTracesAtom", () => {
  it("returns all traces when no filter is active", () => {
    const store = createStore();
    const traces = [makeTrace({ traceID: "a" }), makeTrace({ traceID: "b" })];
    store.set(tracesAtom, traces);
    expect(store.get(filteredTracesAtom)).toBe(traces);
  });

  it("filters by search text (service name)", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({ traceID: "a", serviceName: "frontend" }),
      makeTrace({ traceID: "b", serviceName: "backend" }),
    ]);
    store.set(traceFiltersAtom, {
      search: "front",
      status: new Set(),
      durationMin: null,
      durationMax: null,
    });
    expect(store.get(filteredTracesAtom)).toHaveLength(1);
    expect(store.get(filteredTracesAtom)[0].traceID).toBe("a");
  });

  it("filters by status", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({ traceID: "ok", rootSpan: makeSpan({ statusCode: "Ok" }) }),
      makeTrace({ traceID: "err", rootSpan: makeSpan({ statusCode: "Error" }) }),
    ]);
    store.set(traceFiltersAtom, {
      search: "",
      status: new Set(["Error"]),
      durationMin: null,
      durationMax: null,
    });
    expect(store.get(filteredTracesAtom)).toHaveLength(1);
    expect(store.get(filteredTracesAtom)[0].traceID).toBe("err");
  });

  it("filters by duration range", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({ traceID: "fast", duration: 1_000 }),
      makeTrace({ traceID: "slow", duration: 1_000_000 }),
    ]);
    store.set(traceFiltersAtom, {
      search: "",
      status: new Set(),
      durationMin: 500_000,
      durationMax: null,
    });
    expect(store.get(filteredTracesAtom)).toHaveLength(1);
    expect(store.get(filteredTracesAtom)[0].traceID).toBe("slow");
  });
});

describe("filteredLogsAtom", () => {
  it("returns all logs when no filter is active", () => {
    const store = createStore();
    const logs = [makeLog(), makeLog({ body: "other" })];
    store.set(logsAtom, logs);
    expect(store.get(filteredLogsAtom)).toBe(logs);
  });

  it("filters by body search text", () => {
    const store = createStore();
    store.set(logsAtom, [makeLog({ body: "error occurred" }), makeLog({ body: "all ok" })]);
    store.set(logFiltersAtom, { search: "error", severity: new Set(), service: "" });
    expect(store.get(filteredLogsAtom)).toHaveLength(1);
  });

  it("filters by severity", () => {
    const store = createStore();
    store.set(logsAtom, [makeLog({ severityText: "ERROR" }), makeLog({ severityText: "INFO" })]);
    store.set(logFiltersAtom, { search: "", severity: new Set(["ERROR"]), service: "" });
    expect(store.get(filteredLogsAtom)).toHaveLength(1);
  });

  it("respects traceID filter from navigation", () => {
    const store = createStore();
    store.set(logsAtom, [makeLog({ traceID: "abc" }), makeLog({ traceID: "def" })]);
    store.set(logTraceFilterAtom, "abc");
    expect(store.get(filteredLogsAtom)).toHaveLength(1);
  });
});

describe("filteredMetricsAtom", () => {
  it("returns all metrics when no filter is active", () => {
    const store = createStore();
    const metrics = [makeMetric()];
    store.set(metricsAtom, metrics);
    expect(store.get(filteredMetricsAtom)).toBe(metrics);
  });

  it("filters by name search", () => {
    const store = createStore();
    store.set(metricsAtom, [
      makeMetric({ name: "http.requests" }),
      makeMetric({ name: "db.queries" }),
    ]);
    store.set(metricFiltersAtom, { search: "http", type: new Set() });
    expect(store.get(filteredMetricsAtom)).toHaveLength(1);
  });

  it("filters by type", () => {
    const store = createStore();
    store.set(metricsAtom, [
      makeMetric({ name: "a", type: "Gauge" }),
      makeMetric({ name: "b", type: "Sum" }),
    ]);
    store.set(metricFiltersAtom, { search: "", type: new Set(["Gauge"]) });
    expect(store.get(filteredMetricsAtom)).toHaveLength(1);
  });
});
