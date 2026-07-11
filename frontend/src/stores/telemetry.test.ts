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
  mergeTraceSpansAtom,
  mergeManyTraceSpansAtom,
  appendTracesAtom,
  appendLogsAtom,
  setTracesAtom,
  serverMatchedTraceIdsAtom,
} from "./telemetry";
import { selectedTraceIdAtom, selectedMetricKeyAtom, selectedLogIdAtom } from "./navigation";
import { makeMetric, makeDataPoint, makeTrace, makeLog, makeSpan } from "@/test/factories";

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

describe("mergeTraceSpansAtom", () => {
  it("merges lazily-fetched spans into the matching trace, deduping by spanId", () => {
    const store = createStore();
    const existingSpan = makeSpan({ spanId: "a" });
    store.set(tracesAtom, [
      makeTrace({ traceId: "t1", spanCount: 2, spans: [existingSpan] }),
      makeTrace({ traceId: "t2", spanCount: 1, spans: [] }),
    ]);

    store.set(mergeTraceSpansAtom, {
      traceId: "t1",
      spans: [existingSpan, makeSpan({ spanId: "b" })],
    });

    const traces = store.get(tracesAtom);
    expect(traces.find((t) => t.traceId === "t1")?.spans.map((s) => s.spanId)).toEqual(["a", "b"]);
    // The other trace is untouched.
    expect(traces.find((t) => t.traceId === "t2")?.spans).toEqual([]);
  });

  it("leaves spanCount/duration/rootSpan/serviceName untouched — only spans changes", () => {
    const store = createStore();
    const rootSpan = { name: "GET /x", kind: "Server", statusCode: "Ok" as const, duration: 5 };
    store.set(tracesAtom, [
      makeTrace({
        traceId: "t1",
        spanCount: 3,
        duration: 999,
        serviceName: "svc-summary",
        rootSpan,
        spans: [],
      }),
    ]);

    store.set(mergeTraceSpansAtom, { traceId: "t1", spans: [makeSpan()] });

    const trace = store.get(tracesAtom)[0];
    expect(trace.spanCount).toBe(3);
    expect(trace.duration).toBe(999);
    expect(trace.serviceName).toBe("svc-summary");
    expect(trace.rootSpan).toEqual(rootSpan);
  });

  it("is a no-op when the traceId isn't in the buffer", () => {
    const store = createStore();
    store.set(tracesAtom, [makeTrace({ traceId: "t1", spans: [] })]);

    store.set(mergeTraceSpansAtom, { traceId: "unknown", spans: [makeSpan()] });

    expect(store.get(tracesAtom)).toHaveLength(1);
    expect(store.get(tracesAtom)[0].spans).toEqual([]);
  });
});

describe("mergeManyTraceSpansAtom", () => {
  it("merges spans for several traces in one update", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({ traceId: "t1", spanCount: 1, spans: [] }),
      makeTrace({ traceId: "t2", spanCount: 1, spans: [] }),
      makeTrace({ traceId: "t3", spanCount: 1, spans: [] }),
    ]);

    store.set(mergeManyTraceSpansAtom, [
      { traceId: "t1", spans: [makeSpan({ spanId: "a" })] },
      { traceId: "t3", spans: [makeSpan({ spanId: "c" })] },
    ]);

    const traces = store.get(tracesAtom);
    expect(traces.find((t) => t.traceId === "t1")?.spans).toHaveLength(1);
    expect(traces.find((t) => t.traceId === "t2")?.spans).toHaveLength(0);
    expect(traces.find((t) => t.traceId === "t3")?.spans).toHaveLength(1);
  });

  it("does nothing when given an empty payload list", () => {
    const store = createStore();
    const traces = [makeTrace({ traceId: "t1", spans: [] })];
    store.set(tracesAtom, traces);

    store.set(mergeManyTraceSpansAtom, []);

    // Same array reference: no spurious tracesAtom write.
    expect(store.get(tracesAtom)).toBe(traces);
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

describe("appendTracesAtom", () => {
  it("appends older-page traces to the tail, after whatever's already loaded", () => {
    const store = createStore();
    store.set(tracesAtom, [makeTrace({ traceId: "a" })]);

    store.set(appendTracesAtom, [makeTrace({ traceId: "b" }), makeTrace({ traceId: "c" })]);

    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["a", "b", "c"]);
  });

  it("dedups against traces already present (e.g. delivered live via WebSocket)", () => {
    const store = createStore();
    store.set(tracesAtom, [makeTrace({ traceId: "a" }), makeTrace({ traceId: "b" })]);

    store.set(appendTracesAtom, [makeTrace({ traceId: "b" }), makeTrace({ traceId: "c" })]);

    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when every appended trace is already present", () => {
    const store = createStore();
    const traces = [makeTrace({ traceId: "a" })];
    store.set(tracesAtom, traces);

    store.set(appendTracesAtom, [makeTrace({ traceId: "a" })]);

    expect(store.get(tracesAtom)).toBe(traces);
  });

  it("evicts the oldest (front-most) traces once the append exceeds the client cap", () => {
    const store = createStore();
    store.set(serverConfigAtom, { traceCap: 2, metricCap: 10, logCap: 10, maxDataPoints: 10 });
    store.set(tracesAtom, [makeTrace({ traceId: "a" })]);

    store.set(appendTracesAtom, [makeTrace({ traceId: "b" }), makeTrace({ traceId: "c" })]);

    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["a", "b"]);
  });

  // See serverMatchedTraceIdsAtom's doc: a trace the server returned for the
  // active search is server-vouched even when the append dedups it out of
  // the buffer (the WS-delivered entry stays) — the filter must still let
  // the existing entry pass.
  it("marks every appended id server-vouched, including ones deduped against the live buffer", () => {
    const store = createStore();
    store.set(setTracesAtom, [makeTrace({ traceId: "a" })]);
    store.set(tracesAtom, [makeTrace({ traceId: "ws-b" }), makeTrace({ traceId: "a" })]);

    store.set(appendTracesAtom, [makeTrace({ traceId: "ws-b" }), makeTrace({ traceId: "c" })]);

    expect(store.get(serverMatchedTraceIdsAtom)).toEqual(new Set(["a", "ws-b", "c"]));
  });
});

describe("appendLogsAtom", () => {
  it("appends older-page logs to the tail, after whatever's already loaded", () => {
    const store = createStore();
    store.set(logsAtom, [makeLog({ id: "a" })]);

    store.set(appendLogsAtom, [makeLog({ id: "b" }), makeLog({ id: "c" })]);

    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("dedups against logs already present (e.g. delivered live via WebSocket)", () => {
    const store = createStore();
    store.set(logsAtom, [makeLog({ id: "a" }), makeLog({ id: "b" })]);

    store.set(appendLogsAtom, [makeLog({ id: "b" }), makeLog({ id: "c" })]);

    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when every appended log is already present", () => {
    const store = createStore();
    const logs = [makeLog({ id: "a" })];
    store.set(logsAtom, logs);

    store.set(appendLogsAtom, [makeLog({ id: "a" })]);

    expect(store.get(logsAtom)).toBe(logs);
  });

  it("evicts the oldest (front-most) logs once the append exceeds the client cap", () => {
    const store = createStore();
    store.set(serverConfigAtom, { traceCap: 10, metricCap: 10, logCap: 2, maxDataPoints: 10 });
    store.set(logsAtom, [makeLog({ id: "a" })]);

    store.set(appendLogsAtom, [makeLog({ id: "b" }), makeLog({ id: "c" })]);

    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a", "b"]);
  });
});
