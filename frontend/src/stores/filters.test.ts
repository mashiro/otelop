import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  tracesAtom,
  metricsAtom,
  logsAtom,
  logTraceFilterAtom,
  setTracesAtom,
  setLogsAtom,
  addTraceAtom,
  addLogAtom,
} from "./telemetry";
import { selectedLogRangeAtom, selectedTraceRangeAtom } from "./navigation";
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
  it("returns all traces when no search is active and the range is 'all'", () => {
    const store = createStore();
    const traces = [makeTrace({ traceId: "a" }), makeTrace({ traceId: "b" })];
    store.set(tracesAtom, traces);
    store.set(selectedTraceRangeAtom, "all");
    expect(store.get(filteredTracesAtom)).toBe(traces);
  });

  it("applies the selected trace range as a live-tail display filter, anchored on the newest startTime", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({ traceId: "old", startTime: "2024-01-01T00:00:00Z" }),
      makeTrace({ traceId: "new", startTime: "2024-01-01T00:20:00Z" }),
    ]);
    store.set(selectedTraceRangeAtom, "5m");

    expect(store.get(filteredTracesAtom).map((t) => t.traceId)).toEqual(["new"]);
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

  // Mirrors query_trace.go's TracesPage search: a live (WS-delivered) trace
  // carries its full spans array (unlike a server-paginated summary row,
  // which starts spans: [] — see hooks/use-trace-list-page.ts), so a
  // non-root span's name is still a valid match, not just the root's.
  it("filters by a non-root span's name", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({
        traceId: "a",
        rootSpan: makeSpan({ name: "GET /orders" }),
        spans: [makeSpan({ name: "GET /orders" }), makeSpan({ spanId: "s2", name: "db.query" })],
      }),
      makeTrace({ traceId: "b", rootSpan: makeSpan({ name: "GET /orders" }) }),
    ]);
    store.set(traceSearchAtom, "db.query");
    expect(store.get(filteredTracesAtom).map((t) => t.traceId)).toEqual(["a"]);
  });

  // Mirrors query_trace.go's status_code search field: searching "error"
  // surfaces error traces via a span's status even when no name/service
  // contains the query.
  it("filters by a span's status code", () => {
    const store = createStore();
    store.set(tracesAtom, [
      makeTrace({
        traceId: "a",
        rootSpan: makeSpan({ name: "GET /orders", statusCode: "Error" }),
        spans: [makeSpan({ name: "GET /orders", statusCode: "Error" })],
      }),
      makeTrace({ traceId: "b", rootSpan: makeSpan({ name: "GET /orders" }) }),
    ]);
    store.set(traceSearchAtom, "error");
    expect(store.get(filteredTracesAtom).map((t) => t.traceId)).toEqual(["a"]);
  });

  // The server-vouched pass-through (issue #161): a server-paginated summary
  // row carries spans: [], so the client predicate can't see the non-root
  // span-name/status field the server matched — rows the server returned for
  // the active search must stay visible without re-proving the match.
  it("keeps a server-returned summary row visible even when the client predicate can't match it", () => {
    const store = createStore();
    const summary = makeTrace({
      traceId: "srv1",
      serviceName: "checkout",
      rootSpan: makeSpan({ name: "checkout.process" }),
      spans: [],
    });
    store.set(setTracesAtom, [summary]);
    store.set(traceSearchAtom, "db.query");
    expect(store.get(filteredTracesAtom).map((t) => t.traceId)).toEqual(["srv1"]);
  });

  it("hides a live-prepended non-matching trace during an active search, but shows a matching one", () => {
    const store = createStore();
    store.set(setTracesAtom, [makeTrace({ traceId: "srv1", serviceName: "checkout", spans: [] })]);
    store.set(traceSearchAtom, "checkout");

    store.set(
      addTraceAtom,
      makeTrace({
        traceId: "live-miss",
        serviceName: "billing",
        rootSpan: makeSpan({ name: "billing.run" }),
        spans: [makeSpan({ name: "billing.run", serviceName: "billing" })],
      }),
    );
    store.set(
      addTraceAtom,
      makeTrace({
        traceId: "live-hit",
        serviceName: "checkout",
        rootSpan: makeSpan({ name: "checkout.retry" }),
        spans: [makeSpan({ name: "checkout.retry", serviceName: "checkout" })],
      }),
    );

    expect(store.get(filteredTracesAtom).map((t) => t.traceId)).toEqual(["live-hit", "srv1"]);
  });

  it("clearing the search restores every buffered trace, including hidden live prepends", () => {
    const store = createStore();
    store.set(setTracesAtom, [makeTrace({ traceId: "srv1", serviceName: "checkout", spans: [] })]);
    store.set(traceSearchAtom, "checkout");
    store.set(addTraceAtom, makeTrace({ traceId: "live-miss", serviceName: "billing", spans: [] }));
    expect(store.get(filteredTracesAtom).map((t) => t.traceId)).toEqual(["srv1"]);

    store.set(traceSearchAtom, "");
    expect(store.get(filteredTracesAtom).map((t) => t.traceId)).toEqual(["live-miss", "srv1"]);
  });

  // A new page-1 fetch (range/search change) replaces the server-vouched set:
  // ids from the previous search session must not keep passing the filter.
  it("drops server-vouched ids from a previous fetch session on the next page 1", () => {
    const store = createStore();
    store.set(setTracesAtom, [
      makeTrace({ traceId: "old-srv", serviceName: "checkout", spans: [] }),
    ]);
    store.set(traceSearchAtom, "db.query");
    expect(store.get(filteredTracesAtom).map((t) => t.traceId)).toEqual(["old-srv"]);

    // The next fetch session (e.g. the search changed) returns different rows;
    // if old-srv somehow re-entered the buffer as a non-matching live row, the
    // stale vouch must not resurrect it.
    store.set(setTracesAtom, [
      makeTrace({ traceId: "new-srv", serviceName: "billing", spans: [] }),
    ]);
    store.set(addTraceAtom, makeTrace({ traceId: "old-srv", serviceName: "checkout", spans: [] }));
    expect(store.get(filteredTracesAtom).map((t) => t.traceId)).toEqual(["new-srv"]);
  });
});

describe("filteredLogsAtom", () => {
  it("returns all logs when no search is active and the range is 'all'", () => {
    const store = createStore();
    const logs = [makeLog(), makeLog({ body: "other" })];
    store.set(logsAtom, logs);
    store.set(selectedLogRangeAtom, "all");
    expect(store.get(filteredLogsAtom)).toBe(logs);
  });

  it("applies the selected log range as a live-tail display filter, anchored on the newest timestamp", () => {
    const store = createStore();
    store.set(logsAtom, [
      makeLog({ id: "old", timestamp: "2024-01-01T00:00:00Z" }),
      makeLog({ id: "new", timestamp: "2024-01-01T00:20:00Z" }),
    ]);
    store.set(selectedLogRangeAtom, "5m");

    expect(store.get(filteredLogsAtom).map((l) => l.id)).toEqual(["new"]);
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

  it("filters by trace ID text search", () => {
    const store = createStore();
    store.set(logsAtom, [
      makeLog({ traceId: "abc123", body: "a" }),
      makeLog({ traceId: "def456", body: "b" }),
    ]);
    store.set(logSearchAtom, "abc");
    expect(store.get(filteredLogsAtom)).toHaveLength(1);
  });

  it("respects traceId filter from navigation", () => {
    const store = createStore();
    store.set(logsAtom, [makeLog({ traceId: "abc" }), makeLog({ traceId: "def" })]);
    store.set(logTraceFilterAtom, "abc");
    expect(store.get(filteredLogsAtom)).toHaveLength(1);
  });

  // See the trace-side server-vouched tests above — same issue #161
  // pass-through/live-prepend/clear semantics for the logs list.
  it("keeps a server-returned log visible without re-proving the match client-side", () => {
    const store = createStore();
    // The server can match on fields/normalizations the client predicate may
    // not reproduce; a vouched id passes regardless of the client fields.
    store.set(setLogsAtom, [makeLog({ id: "srv1", body: "unrelated body" })]);
    store.set(logSearchAtom, "no-client-field-contains-this");
    expect(store.get(filteredLogsAtom).map((l) => l.id)).toEqual(["srv1"]);
  });

  it("hides a live-prepended non-matching log during an active search, but shows a matching one", () => {
    const store = createStore();
    store.set(setLogsAtom, [makeLog({ id: "srv1", body: "payment declined" })]);
    store.set(logSearchAtom, "payment");

    store.set(addLogAtom, makeLog({ id: "live-miss", body: "cache warmed" }));
    store.set(addLogAtom, makeLog({ id: "live-hit", body: "payment retried" }));

    expect(store.get(filteredLogsAtom).map((l) => l.id)).toEqual(["live-hit", "srv1"]);
  });

  it("clearing the search restores every buffered log, including hidden live prepends", () => {
    const store = createStore();
    store.set(setLogsAtom, [makeLog({ id: "srv1", body: "payment declined" })]);
    store.set(logSearchAtom, "payment");
    store.set(addLogAtom, makeLog({ id: "live-miss", body: "cache warmed" }));
    expect(store.get(filteredLogsAtom).map((l) => l.id)).toEqual(["srv1"]);

    store.set(logSearchAtom, "");
    expect(store.get(filteredLogsAtom).map((l) => l.id)).toEqual(["live-miss", "srv1"]);
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
