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
import { makeSpan, makeTrace, makeLog, makeMetric } from "@/test/factories";

describe("filteredTracesAtom", () => {
  it("returns all traces when no search is active", () => {
    const store = createStore();
    const traces = [makeTrace({ traceId: "a" }), makeTrace({ traceId: "b" })];
    store.set(tracesAtom, traces);
    expect(store.get(filteredTracesAtom)).toBe(traces);
  });

  it("filters by service name", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({ traceId: "a", serviceName: "frontend" }),
      makeTrace({ traceId: "b", serviceName: "backend" }),
    ]);
    store.set(traceSearchAtom, "front");
    expect(store.get(filteredTracesAtom)).toHaveLength(1);
    expect(store.get(filteredTracesAtom)[0].traceId).toBe("a");
  });

  it("filters by span name", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({ traceId: "a", rootSpan: makeSpan({ name: "GET /users" }) }),
      makeTrace({ traceId: "b", rootSpan: makeSpan({ name: "POST /orders" }) }),
    ]);
    store.set(traceSearchAtom, "users");
    expect(store.get(filteredTracesAtom)).toHaveLength(1);
    expect(store.get(filteredTracesAtom)[0].traceId).toBe("a");
  });

  it("filters by trace ID", () => {
    const store = createStore();
    store.set(tracesAtom, [makeTrace({ traceId: "abc123" }), makeTrace({ traceId: "def456" })]);
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

  it("respects traceId filter from navigation", () => {
    const store = createStore();
    store.set(logsAtom, [makeLog({ traceId: "abc" }), makeLog({ traceId: "def" })]);
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
