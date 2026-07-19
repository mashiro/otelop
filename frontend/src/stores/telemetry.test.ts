import { describe, it, expect } from "vite-plus/test";
import { createStore } from "jotai";
import {
  metricsAtom,
  addMetricAtom,
  addMetricsAtom,
  addTraceAtom,
  addTracesAtom,
  cacheTraceAtom,
  removeTraceAtom,
  addLogAtom,
  addLogsAtom,
  bufferCapsAtom,
  tracesAtom,
  logsAtom,
  logCountAtom,
  metricCountAtom,
  traceCountAtom,
  totalTraceCountAtom,
  totalMetricCountAtom,
  totalLogCountAtom,
  newTraceCountAtom,
  removedTraceCountAtom,
  newMetricCountAtom,
  newLogCountAtom,
  setTotalCountsAtom,
  selectedTraceAtom,
  selectedMetricAtom,
  selectedLogAtom,
  mergeTraceSpansAtom,
  appendTracesAtom,
  appendLogsAtom,
  setTracesAtom,
  setLogsAtom,
  serverMatchedTraceIdsAtom,
  navigateToTraceAtom,
  loadedOlderTraceIdsAtom,
  loadedOlderLogIdsAtom,
} from "./telemetry";
import {
  activeTabAtom,
  selectedTraceIdAtom,
  selectedMetricKeyAtom,
  selectedLogIdAtom,
} from "./navigation";
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
    store.set(bufferCapsAtom, { ...store.get(bufferCapsAtom), maxDataPoints: 2 });
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

  it("widens pointCount by exactly the genuinely-new-point delta, and updates latestValue only then", () => {
    const store = createStore();
    store.set(metricsAtom, [
      makeMetric({
        name: "m",
        dataPoints: [makeDataPoint({ id: "a", value: 1 })],
        pointCount: 10,
        latestValue: 1,
      }),
    ]);

    // Re-delivers "a" (already seen) plus one genuinely new point "b".
    store.set(
      addMetricAtom,
      makeMetric({
        name: "m",
        dataPoints: [makeDataPoint({ id: "a", value: 1 }), makeDataPoint({ id: "b", value: 2 })],
      }),
    );

    const metric = store.get(metricsAtom)[0];
    expect(metric.pointCount).toBe(11);
    expect(metric.latestValue).toBe(2);
  });

  it("leaves pointCount/latestValue untouched when a delivery merges no genuinely new points", () => {
    const store = createStore();
    const a = makeDataPoint({ id: "a", value: 1 });
    store.set(metricsAtom, [
      makeMetric({ name: "m", dataPoints: [a], pointCount: 10, latestValue: 1 }),
    ]);

    // Re-delivers only "a" — already seen, nothing new.
    store.set(addMetricAtom, makeMetric({ name: "m", dataPoints: [a] }));

    const metric = store.get(metricsAtom)[0];
    expect(metric.pointCount).toBe(10);
    expect(metric.latestValue).toBe(1);
  });

  it("initializes pointCount/latestValue from dataPoints for a brand-new group (never trusts the wire payload, which has neither field)", () => {
    const store = createStore();

    store.set(
      addMetricAtom,
      makeMetric({
        name: "new.metric",
        dataPoints: [makeDataPoint({ id: "a", value: 1 }), makeDataPoint({ id: "b", value: 2 })],
      }),
    );

    const metric = store.get(metricsAtom)[0];
    expect(metric.pointCount).toBe(2);
    expect(metric.latestValue).toBe(2);
  });
});

describe("header badge totals (traceCountAtom/metricCountAtom/logCountAtom)", () => {
  it("start at 0 + 0 before any load", () => {
    const store = createStore();
    expect(store.get(traceCountAtom)).toBe(0);
    expect(store.get(metricCountAtom)).toBe(0);
    expect(store.get(logCountAtom)).toBe(0);
  });

  it("setTotalCountsAtom seeds the totals; badges reflect total + 0 with nothing new yet", () => {
    const store = createStore();
    store.set(setTotalCountsAtom, { traceCount: 300, metricCount: 5, logCount: 300 });

    expect(store.get(totalTraceCountAtom)).toBe(300);
    expect(store.get(totalMetricCountAtom)).toBe(5);
    expect(store.get(totalLogCountAtom)).toBe(300);
    expect(store.get(traceCountAtom)).toBe(300);
    expect(store.get(metricCountAtom)).toBe(5);
    expect(store.get(logCountAtom)).toBe(300);
  });

  it("a WS delivery that creates a brand-new trace increments the badge", () => {
    const store = createStore();
    store.set(setTotalCountsAtom, { traceCount: 300, metricCount: 0, logCount: 0 });

    store.set(addTraceAtom, makeTrace({ traceId: "new-trace" }));

    expect(store.get(newTraceCountAtom)).toBe(1);
    expect(store.get(traceCountAtom)).toBe(301);
  });

  it("an oversized-trace deletion removes stale UI state and decrements the badge", () => {
    const store = createStore();
    store.set(setTotalCountsAtom, { traceCount: 300, metricCount: 0, logCount: 0 });
    const trace = makeTrace({ traceId: "oversized" });
    store.set(tracesAtom, [trace]);
    store.set(selectedTraceAtom, trace);

    store.set(removeTraceAtom, trace.traceId);

    expect(store.get(tracesAtom)).toEqual([]);
    expect(store.get(selectedTraceIdAtom)).toBeNull();
    expect(store.get(removedTraceCountAtom)).toBe(1);
    expect(store.get(traceCountAtom)).toBe(299);
  });

  it("a WS delivery that merges into an existing trace does not increment the badge", () => {
    const store = createStore();
    store.set(setTotalCountsAtom, { traceCount: 300, metricCount: 0, logCount: 0 });
    store.set(tracesAtom, [makeTrace({ traceId: "t1", spanCount: 1 })]);

    // Same traceId, one more span — a merge, not a create.
    store.set(
      addTraceAtom,
      makeTrace({ traceId: "t1", spanCount: 2, spans: [makeSpan({ spanId: "s2" })] }),
    );

    expect(store.get(newTraceCountAtom)).toBe(0);
    expect(store.get(traceCountAtom)).toBe(300);
  });

  it("merges a summary-only WS update without discarding lazily fetched spans", () => {
    const store = createStore();
    const loadedSpan = makeSpan({ spanId: "s1" });
    store.set(tracesAtom, [
      makeTrace({ traceId: "t1", spanCount: 1, spans: [loadedSpan], duration: 10 }),
    ]);

    store.set(addTraceAtom, makeTrace({ traceId: "t1", spanCount: 2, spans: [], duration: 20 }));

    const trace = store.get(tracesAtom)[0];
    expect(trace.spans).toEqual([loadedSpan]);
    expect(trace.spanCount).toBe(2);
    expect(trace.duration).toBe(20);
  });

  it("orders new WebSocket traces by trace start rather than arrival", () => {
    const store = createStore();
    store.set(addTraceAtom, makeTrace({ traceId: "later", startTime: "2024-01-01T00:20:00Z" }));
    store.set(addTraceAtom, makeTrace({ traceId: "earlier", startTime: "2024-01-01T00:10:00Z" }));

    expect(store.get(tracesAtom).map((trace) => trace.traceId)).toEqual(["later", "earlier"]);
  });

  it("repositions a trace when a late span moves its start time earlier", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({ traceId: "moving", startTime: "2024-01-01T00:20:00Z" }),
      makeTrace({ traceId: "stable", startTime: "2024-01-01T00:10:00Z" }),
    ]);

    store.set(
      addTraceAtom,
      makeTrace({
        traceId: "moving",
        startTime: "2024-01-01T00:00:00Z",
        spans: [
          makeSpan({ spanId: "s1", startTime: "2024-01-01T00:20:00Z" }),
          makeSpan({ spanId: "s2", startTime: "2024-01-01T00:00:00Z" }),
        ],
      }),
    );

    expect(store.get(tracesAtom).map((trace) => trace.traceId)).toEqual(["stable", "moving"]);
    expect(store.get(tracesAtom)[1].startTime).toBe("2024-01-01T00:00:00Z");
  });

  it("appendTracesAtom (Load more) does not increment the badge — those rows are already in the total", () => {
    const store = createStore();
    store.set(setTotalCountsAtom, { traceCount: 300, metricCount: 0, logCount: 0 });
    store.set(tracesAtom, [makeTrace({ traceId: "a" })]);

    store.set(appendTracesAtom, [makeTrace({ traceId: "b" }), makeTrace({ traceId: "c" })]);

    expect(store.get(newTraceCountAtom)).toBe(0);
    expect(store.get(traceCountAtom)).toBe(300);
  });

  it("setTracesAtom (page 1 replace) does not increment the badge", () => {
    const store = createStore();
    store.set(setTotalCountsAtom, { traceCount: 300, metricCount: 0, logCount: 0 });

    store.set(setTracesAtom, [makeTrace({ traceId: "a" }), makeTrace({ traceId: "b" })]);

    expect(store.get(newTraceCountAtom)).toBe(0);
    expect(store.get(traceCountAtom)).toBe(300);
  });

  it("a WS delivery that creates a brand-new metric group increments the badge", () => {
    const store = createStore();
    store.set(setTotalCountsAtom, { traceCount: 0, metricCount: 5, logCount: 0 });

    store.set(addMetricAtom, makeMetric({ name: "new.metric" }));

    expect(store.get(newMetricCountAtom)).toBe(1);
    expect(store.get(metricCountAtom)).toBe(6);
  });

  it("a WS delivery that merges into an existing metric group does not increment the badge", () => {
    const store = createStore();
    store.set(setTotalCountsAtom, { traceCount: 0, metricCount: 5, logCount: 0 });
    store.set(metricsAtom, [makeMetric({ name: "m", dataPoints: [makeDataPoint({ id: "a" })] })]);

    store.set(addMetricAtom, makeMetric({ name: "m", dataPoints: [makeDataPoint({ id: "b" })] }));

    expect(store.get(newMetricCountAtom)).toBe(0);
    expect(store.get(metricCountAtom)).toBe(5);
  });

  it("every log delivery increments the badge (logs have no merge concept)", () => {
    const store = createStore();
    store.set(setTotalCountsAtom, { traceCount: 0, metricCount: 0, logCount: 300 });

    store.set(addLogAtom, makeLog({ id: "log-new" }));

    expect(store.get(newLogCountAtom)).toBe(1);
    expect(store.get(logCountAtom)).toBe(301);
  });
});

describe("addTraceAtom searchValues merge", () => {
  // Each WS batch's searchValues covers only that batch's spans (see
  // internal/broadcast/broadcast.go's traceSearchValues) while mergeSpans
  // unions the spans themselves — searchValues must be unioned the same way,
  // not replaced, or a value only present in an earlier batch stops matching
  // the active search after a later batch merges in.
  it("unions searchValues across merges instead of replacing them", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({ traceId: "t1", spanCount: 1, searchValues: ["first-batch-only"] }),
    ]);

    store.set(
      addTraceAtom,
      makeTrace({
        traceId: "t1",
        spanCount: 2,
        spans: [makeSpan({ spanId: "s2" })],
        searchValues: ["second-batch-only"],
      }),
    );

    expect(store.get(tracesAtom)[0].searchValues).toEqual(
      expect.arrayContaining(["first-batch-only", "second-batch-only"]),
    );
    expect(store.get(tracesAtom)[0].searchValues).toHaveLength(2);
  });

  it("dedups values seen in both batches", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({ traceId: "t1", spanCount: 1, searchValues: ["shared", "only-first"] }),
    ]);

    store.set(
      addTraceAtom,
      makeTrace({
        traceId: "t1",
        spanCount: 2,
        spans: [makeSpan({ spanId: "s2" })],
        searchValues: ["shared", "only-second"],
      }),
    );

    expect(new Set(store.get(tracesAtom)[0].searchValues)).toEqual(
      new Set(["shared", "only-first", "only-second"]),
    );
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

describe("cacheTraceAtom", () => {
  it("caches a retained trace fetched by ID without incrementing the live total", () => {
    const store = createStore();

    store.set(cacheTraceAtom, makeTrace({ traceId: "outside-page" }));

    expect(store.get(tracesAtom).map((trace) => trace.traceId)).toEqual(["outside-page"]);
    expect(store.get(newTraceCountAtom)).toBe(0);
  });

  it("merges fetched spans when a summary arrives during the focused request", () => {
    const store = createStore();
    store.set(tracesAtom, [makeTrace({ traceId: "t1", spanCount: 1, spans: [] })]);

    store.set(
      cacheTraceAtom,
      makeTrace({ traceId: "t1", spanCount: 1, spans: [makeSpan({ spanId: "s1" })] }),
    );

    expect(store.get(tracesAtom)[0].spans.map((span) => span.spanId)).toEqual(["s1"]);
  });

  it("retains an old focused trace when the newest-first buffer is full", () => {
    const store = createStore();
    store.set(bufferCapsAtom, { ...store.get(bufferCapsAtom), traceCap: 2 });
    store.set(tracesAtom, [
      makeTrace({ traceId: "newest", startTime: "2024-01-03T00:00:00Z" }),
      makeTrace({ traceId: "newer", startTime: "2024-01-02T00:00:00Z" }),
    ]);

    store.set(
      cacheTraceAtom,
      makeTrace({ traceId: "focused-old", startTime: "2024-01-01T00:00:00Z" }),
    );

    expect(store.get(tracesAtom).map((trace) => trace.traceId)).toEqual(["newest", "focused-old"]);
  });
});

describe("navigateToTraceAtom", () => {
  it("selects and opens a trace even when it is absent from the current list buffer", () => {
    const store = createStore();

    store.set(navigateToTraceAtom, "outside-page");

    expect(store.get(selectedTraceIdAtom)).toBe("outside-page");
    expect(store.get(activeTabAtom)).toBe("traces");
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
    expect(store.get(loadedOlderTraceIdsAtom)).toEqual(new Set(["b", "c"]));
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
    store.set(bufferCapsAtom, { traceCap: 2, metricCap: 10, logCap: 10, maxDataPoints: 10 });
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

  it("resets loaded-history IDs when a new page session replaces the list", () => {
    const store = createStore();
    store.set(appendTracesAtom, [makeTrace({ traceId: "older" })]);

    store.set(setTracesAtom, [makeTrace({ traceId: "new-page" })]);

    expect(store.get(loadedOlderTraceIdsAtom)).toEqual(new Set());
  });
});

describe("appendLogsAtom", () => {
  it("appends older-page logs to the tail, after whatever's already loaded", () => {
    const store = createStore();
    store.set(logsAtom, [makeLog({ id: "a" })]);

    store.set(appendLogsAtom, [makeLog({ id: "b" }), makeLog({ id: "c" })]);

    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(store.get(loadedOlderLogIdsAtom)).toEqual(new Set(["b", "c"]));
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
    store.set(bufferCapsAtom, { traceCap: 10, metricCap: 10, logCap: 2, maxDataPoints: 10 });
    store.set(logsAtom, [makeLog({ id: "a" })]);

    store.set(appendLogsAtom, [makeLog({ id: "b" }), makeLog({ id: "c" })]);

    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("resets loaded-history IDs when a new page session replaces the list", () => {
    const store = createStore();
    store.set(appendLogsAtom, [makeLog({ id: "older" })]);

    store.set(setLogsAtom, [makeLog({ id: "new-page" })]);

    expect(store.get(loadedOlderLogIdsAtom)).toEqual(new Set());
  });
});

// These atoms exist so hooks/use-websocket.ts can flush a whole batching
// window's worth of WS deliveries as one store update instead of one write
// per message (see that file's doc comment). addTraceAtom/addMetricAtom/
// addLogAtom above are thin single-item wrappers over these, so their
// existing behavior is covered by the describe blocks above; these tests
// focus on what only shows up with more than one item in the same write.
describe("addTracesAtom (batched WS flush)", () => {
  it("applies a create and a merge from the same batch in one write", () => {
    const store = createStore();
    store.set(tracesAtom, [makeTrace({ traceId: "existing", spanCount: 1 })]);

    store.set(addTracesAtom, [
      makeTrace({ traceId: "existing", spanCount: 2, spans: [makeSpan({ spanId: "s2" })] }),
      makeTrace({ traceId: "brand-new" }),
    ]);

    expect(
      store
        .get(tracesAtom)
        .map((t) => t.traceId)
        .sort(),
    ).toEqual(["brand-new", "existing"]);
    expect(store.get(tracesAtom).find((t) => t.traceId === "existing")?.spanCount).toBe(2);
    expect(store.get(newTraceCountAtom)).toBe(1);
  });

  it("produces the same newest-first order a sequence of single addTraceAtom calls would", () => {
    const storeBatched = createStore();
    const storeSequential = createStore();
    const traces = [
      makeTrace({ traceId: "a", startTime: "2024-01-01T00:10:00Z" }),
      makeTrace({ traceId: "b", startTime: "2024-01-01T00:30:00Z" }),
      makeTrace({ traceId: "c", startTime: "2024-01-01T00:20:00Z" }),
    ];

    storeBatched.set(addTracesAtom, traces);
    for (const trace of traces) storeSequential.set(addTraceAtom, trace);

    expect(storeBatched.get(tracesAtom).map((t) => t.traceId)).toEqual(
      storeSequential.get(tracesAtom).map((t) => t.traceId),
    );
  });

  it("sorts and slices to the cap exactly once for the whole batch, not once per item", () => {
    const store = createStore();
    store.set(bufferCapsAtom, { ...store.get(bufferCapsAtom), traceCap: 2 });

    store.set(addTracesAtom, [
      makeTrace({ traceId: "a", startTime: "2024-01-01T00:10:00Z" }),
      makeTrace({ traceId: "b", startTime: "2024-01-01T00:30:00Z" }),
      makeTrace({ traceId: "c", startTime: "2024-01-01T00:20:00Z" }),
    ]);

    expect(store.get(tracesAtom).map((t) => t.traceId)).toEqual(["b", "c"]);
  });

  it("is a no-op (including for newTraceCountAtom) given an empty batch", () => {
    const store = createStore();
    const traces = [makeTrace({ traceId: "a" })];
    store.set(tracesAtom, traces);

    store.set(addTracesAtom, []);

    expect(store.get(tracesAtom)).toBe(traces);
    expect(store.get(newTraceCountAtom)).toBe(0);
  });
});

describe("addMetricsAtom (batched WS flush)", () => {
  it("applies a create and a merge from the same batch in one write", () => {
    const store = createStore();
    store.set(metricsAtom, [
      makeMetric({ name: "existing", dataPoints: [makeDataPoint({ id: "a" })] }),
    ]);

    store.set(addMetricsAtom, [
      makeMetric({ name: "existing", dataPoints: [makeDataPoint({ id: "b" })] }),
      makeMetric({ name: "brand-new", dataPoints: [makeDataPoint({ id: "x" })] }),
    ]);

    const metrics = store.get(metricsAtom);
    expect(metrics.map((m) => m.name).sort()).toEqual(["brand-new", "existing"]);
    expect(metrics.find((m) => m.name === "existing")?.dataPoints.map((p) => p.id)).toEqual([
      "a",
      "b",
    ]);
    expect(store.get(newMetricCountAtom)).toBe(1);
  });

  it("merges two deliveries for the same brand-new metric within one batch instead of creating two groups", () => {
    const store = createStore();

    store.set(addMetricsAtom, [
      makeMetric({ name: "m", dataPoints: [makeDataPoint({ id: "a", value: 1 })] }),
      makeMetric({ name: "m", dataPoints: [makeDataPoint({ id: "b", value: 2 })] }),
    ]);

    const metrics = store.get(metricsAtom);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].dataPoints.map((p) => p.id)).toEqual(["a", "b"]);
    expect(metrics[0].pointCount).toBe(2);
    expect(metrics[0].latestValue).toBe(2);
    expect(store.get(newMetricCountAtom)).toBe(1);
  });

  it("produces the same group order a sequence of single addMetricAtom calls would", () => {
    const storeBatched = createStore();
    const storeSequential = createStore();
    const metrics = [
      makeMetric({ name: "a" }),
      makeMetric({ name: "b" }),
      makeMetric({ name: "c" }),
    ];

    storeBatched.set(addMetricsAtom, metrics);
    for (const metric of metrics) storeSequential.set(addMetricAtom, metric);

    expect(storeBatched.get(metricsAtom).map((m) => m.name)).toEqual(
      storeSequential.get(metricsAtom).map((m) => m.name),
    );
  });

  it("is a no-op given an empty batch", () => {
    const store = createStore();
    const metrics = [makeMetric({ name: "a" })];
    store.set(metricsAtom, metrics);

    store.set(addMetricsAtom, []);

    expect(store.get(metricsAtom)).toBe(metrics);
    expect(store.get(newMetricCountAtom)).toBe(0);
  });
});

describe("addLogsAtom (batched WS flush)", () => {
  it("prepends the whole batch, newest (last-arriving) first — same order a sequence of single addLogAtom calls would produce", () => {
    const storeBatched = createStore();
    const storeSequential = createStore();
    const logs = [makeLog({ id: "a" }), makeLog({ id: "b" }), makeLog({ id: "c" })];

    storeBatched.set(addLogsAtom, logs);
    for (const log of logs) storeSequential.set(addLogAtom, log);

    expect(storeBatched.get(logsAtom).map((l) => l.id)).toEqual(["c", "b", "a"]);
    expect(storeBatched.get(logsAtom).map((l) => l.id)).toEqual(
      storeSequential.get(logsAtom).map((l) => l.id),
    );
  });

  it("increments newLogCountAtom by the whole batch size in one write", () => {
    const store = createStore();

    store.set(addLogsAtom, [makeLog({ id: "a" }), makeLog({ id: "b" }), makeLog({ id: "c" })]);

    expect(store.get(newLogCountAtom)).toBe(3);
  });

  it("slices to the cap exactly once for the whole batch", () => {
    const store = createStore();
    store.set(bufferCapsAtom, { ...store.get(bufferCapsAtom), logCap: 2 });
    store.set(logsAtom, [makeLog({ id: "existing" })]);

    store.set(addLogsAtom, [makeLog({ id: "a" }), makeLog({ id: "b" })]);

    expect(store.get(logsAtom).map((l) => l.id)).toEqual(["b", "a"]);
  });

  it("is a no-op given an empty batch", () => {
    const store = createStore();
    const logs = [makeLog({ id: "a" })];
    store.set(logsAtom, logs);

    store.set(addLogsAtom, []);

    expect(store.get(logsAtom)).toBe(logs);
    expect(store.get(newLogCountAtom)).toBe(0);
  });
});
