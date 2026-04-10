import { describe, it, expect } from "vitest";
import { buildServiceGraph } from "./service-graph";
import type { TraceData, SpanData } from "@/types/telemetry";

function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  return {
    traceID: "t1",
    spanID: "s1",
    parentSpanID: "",
    name: "op",
    kind: "Server",
    serviceName: "svc-a",
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

function makeTrace(spans: SpanData[]): TraceData {
  return {
    traceID: spans[0]?.traceID ?? "t1",
    spans,
    spanCount: spans.length,
    serviceName: spans[0]?.serviceName ?? "",
    startTime: spans[0]?.startTime ?? "",
    duration: 1_000_000,
  };
}

describe("buildServiceGraph", () => {
  it("returns empty graph for empty traces", () => {
    const graph = buildServiceGraph([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("creates nodes for each service", () => {
    const trace = makeTrace([
      makeSpan({ spanID: "a", serviceName: "frontend" }),
      makeSpan({ spanID: "b", serviceName: "backend", parentSpanID: "a" }),
    ]);
    const graph = buildServiceGraph([trace]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["backend", "frontend"]);
  });

  it("creates edges between different services", () => {
    const trace = makeTrace([
      makeSpan({ spanID: "a", serviceName: "frontend" }),
      makeSpan({ spanID: "b", serviceName: "backend", parentSpanID: "a" }),
    ]);
    const graph = buildServiceGraph([trace]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      source: "frontend",
      target: "backend",
      callCount: 1,
    });
  });

  it("does not create edges within the same service", () => {
    const trace = makeTrace([
      makeSpan({ spanID: "a", serviceName: "frontend" }),
      makeSpan({ spanID: "b", serviceName: "frontend", parentSpanID: "a" }),
    ]);
    const graph = buildServiceGraph([trace]);
    expect(graph.edges).toHaveLength(0);
  });

  it("accumulates call counts across traces", () => {
    const t1 = makeTrace([
      makeSpan({ traceID: "t1", spanID: "a", serviceName: "web" }),
      makeSpan({ traceID: "t1", spanID: "b", serviceName: "api", parentSpanID: "a" }),
    ]);
    const t2 = makeTrace([
      makeSpan({ traceID: "t2", spanID: "c", serviceName: "web" }),
      makeSpan({ traceID: "t2", spanID: "d", serviceName: "api", parentSpanID: "c" }),
    ]);
    const graph = buildServiceGraph([t1, t2]);
    expect(graph.edges[0].callCount).toBe(2);
  });

  it("counts errors per service", () => {
    const trace = makeTrace([
      makeSpan({ spanID: "a", serviceName: "frontend", statusCode: "Ok" }),
      makeSpan({ spanID: "b", serviceName: "backend", statusCode: "Error", parentSpanID: "a" }),
    ]);
    const graph = buildServiceGraph([trace]);
    const backend = graph.nodes.find((n) => n.id === "backend");
    expect(backend?.errorCount).toBe(1);
  });
});
