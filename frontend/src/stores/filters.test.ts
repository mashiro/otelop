import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import { tracesAtom, metricsAtom, logsAtom, logTraceFilterAtom } from "./telemetry";
import {
  traceSearchAtom,
  filteredTracesAtom,
  logSearchAtom,
  filteredLogsAtom,
  metricSearchAtom,
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
  it("returns all traces when no search is active", () => {
    const store = createStore();
    const traces = [makeTrace({ traceID: "a" }), makeTrace({ traceID: "b" })];
    store.set(tracesAtom, traces);
    expect(store.get(filteredTracesAtom)).toBe(traces);
  });

  it("filters by service name", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({ traceID: "a", serviceName: "frontend" }),
      makeTrace({ traceID: "b", serviceName: "backend" }),
    ]);
    store.set(traceSearchAtom, "front");
    expect(store.get(filteredTracesAtom)).toHaveLength(1);
    expect(store.get(filteredTracesAtom)[0].traceID).toBe("a");
  });

  it("filters by span name", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({ traceID: "a", rootSpan: makeSpan({ name: "GET /users" }) }),
      makeTrace({ traceID: "b", rootSpan: makeSpan({ name: "POST /orders" }) }),
    ]);
    store.set(traceSearchAtom, "users");
    expect(store.get(filteredTracesAtom)).toHaveLength(1);
    expect(store.get(filteredTracesAtom)[0].traceID).toBe("a");
  });

  it("filters by trace ID", () => {
    const store = createStore();
    store.set(tracesAtom, [makeTrace({ traceID: "abc123" }), makeTrace({ traceID: "def456" })]);
    store.set(traceSearchAtom, "abc");
    expect(store.get(filteredTracesAtom)).toHaveLength(1);
  });
});

describe("filteredLogsAtom", () => {
  it("returns all logs when no search is active", () => {
    const store = createStore();
    const logs = [makeLog(), makeLog({ body: "other" })];
    store.set(logsAtom, logs);
    expect(store.get(filteredLogsAtom)).toBe(logs);
  });

  it("filters by body text", () => {
    const store = createStore();
    store.set(logsAtom, [makeLog({ body: "error occurred" }), makeLog({ body: "all ok" })]);
    store.set(logSearchAtom, "error");
    expect(store.get(filteredLogsAtom)).toHaveLength(1);
  });

  it("filters by severity text", () => {
    const store = createStore();
    store.set(logsAtom, [
      makeLog({ severityText: "ERROR", body: "a" }),
      makeLog({ severityText: "INFO", body: "b" }),
    ]);
    store.set(logSearchAtom, "error");
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
  it("returns all metrics when no search is active", () => {
    const store = createStore();
    const metrics = [makeMetric()];
    store.set(metricsAtom, metrics);
    expect(store.get(filteredMetricsAtom)).toBe(metrics);
  });

  it("filters by name", () => {
    const store = createStore();
    store.set(metricsAtom, [
      makeMetric({ name: "http.requests" }),
      makeMetric({ name: "db.queries" }),
    ]);
    store.set(metricSearchAtom, "http");
    expect(store.get(filteredMetricsAtom)).toHaveLength(1);
  });

  it("filters by type", () => {
    const store = createStore();
    store.set(metricsAtom, [
      makeMetric({ name: "a", type: "Gauge" }),
      makeMetric({ name: "b", type: "Sum" }),
    ]);
    store.set(metricSearchAtom, "gauge");
    expect(store.get(filteredMetricsAtom)).toHaveLength(1);
  });
});
