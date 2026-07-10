import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  metricsAtom,
  addMetricAtom,
  serverConfigAtom,
  tracesAtom,
  logsAtom,
  selectedTraceAtom,
  selectedMetricAtom,
  selectedLogAtom,
} from "./telemetry";
import { selectedTraceIdAtom, selectedMetricKeyAtom, selectedLogIdAtom } from "./navigation";
import { makeMetric, makeDataPoint, makeTrace, makeLog } from "@/test/factories";

describe("addMetricAtom", () => {
  it("merges data points by id, dropping re-delivered duplicates", () => {
    const store = createStore();
    const a = makeDataPoint({ id: "a" });
    const b = makeDataPoint({ id: "b" });
    store.set(metricsAtom, [makeMetric({ name: "m", dataPoints: [a, b] })]);

    // The WebSocket re-sends the metric's full accumulated points (a, b) plus a
    // new one (c); a and b must not be duplicated.
    const c = makeDataPoint({ id: "c" });
    store.set(addMetricAtom, makeMetric({ name: "m", dataPoints: [a, b, c] }));

    const points = store.get(metricsAtom)[0].dataPoints;
    expect(points.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("appends genuinely new points", () => {
    const store = createStore();
    store.set(metricsAtom, [makeMetric({ name: "m", dataPoints: [makeDataPoint({ id: "a" })] })]);

    store.set(addMetricAtom, makeMetric({ name: "m", dataPoints: [makeDataPoint({ id: "b" })] }));

    expect(store.get(metricsAtom)[0].dataPoints.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("keeps only the newest maxDataPoints after merging", () => {
    const store = createStore();
    store.set(serverConfigAtom, { ...store.get(serverConfigAtom), maxDataPoints: 2 });
    store.set(metricsAtom, [makeMetric({ name: "m", dataPoints: [makeDataPoint({ id: "a" })] })]);

    store.set(
      addMetricAtom,
      makeMetric({
        name: "m",
        dataPoints: [makeDataPoint({ id: "b" }), makeDataPoint({ id: "c" })],
      }),
    );

    expect(store.get(metricsAtom)[0].dataPoints.map((p) => p.id)).toEqual(["b", "c"]);
  });
});

describe("selectedTraceAtom", () => {
  it("resolves once the matching trace loads, restoring selection after a reload", () => {
    const store = createStore();
    // Simulate a reload where the URL already names a traceId before the
    // WebSocket/REST load has populated tracesAtom.
    store.set(selectedTraceIdAtom, "t1");
    expect(store.get(selectedTraceAtom)).toBeNull();

    store.set(tracesAtom, [makeTrace({ traceId: "t1" })]);
    expect(store.get(selectedTraceAtom)?.traceId).toBe("t1");
  });

  it("setting the atom updates the shared traceId used for URL sync", () => {
    const store = createStore();
    const trace = makeTrace({ traceId: "t2" });
    store.set(tracesAtom, [trace]);

    store.set(selectedTraceAtom, trace);
    expect(store.get(selectedTraceIdAtom)).toBe("t2");

    store.set(selectedTraceAtom, null);
    expect(store.get(selectedTraceIdAtom)).toBeNull();
  });
});

describe("selectedMetricAtom", () => {
  it("setting the atom updates the shared metricKey used for URL sync", () => {
    const store = createStore();
    const metric = makeMetric({ serviceName: "svc", name: "cpu" });
    store.set(metricsAtom, [metric]);

    store.set(selectedMetricAtom, metric);
    expect(store.get(selectedMetricKeyAtom)).toEqual({ serviceName: "svc", name: "cpu" });

    store.set(selectedMetricAtom, null);
    expect(store.get(selectedMetricKeyAtom)).toBeNull();
  });
});

describe("selectedLogAtom", () => {
  it("resolves once the matching log loads, restoring selection after a reload", () => {
    const store = createStore();
    // Simulate a reload where the URL already names a logId before the
    // WebSocket/REST load has populated logsAtom.
    store.set(selectedLogIdAtom, "log-1");
    expect(store.get(selectedLogAtom)).toBeNull();

    store.set(logsAtom, [makeLog({ id: "log-1" })]);
    expect(store.get(selectedLogAtom)?.id).toBe("log-1");
  });

  it("setting the atom updates the shared logId used for URL sync", () => {
    const store = createStore();
    const log = makeLog({ id: "log-2" });
    store.set(logsAtom, [log]);

    store.set(selectedLogAtom, log);
    expect(store.get(selectedLogIdAtom)).toBe("log-2");

    store.set(selectedLogAtom, null);
    expect(store.get(selectedLogIdAtom)).toBeNull();
  });
});
