import { describe, it, expect } from "vitest";
import { buildServiceGraph } from "./service-graph";
import { makeSpan, makeTrace } from "@/test/factories";

describe("buildServiceGraph", () => {
  it("returns empty graph for empty traces", () => {
    const graph = buildServiceGraph([]);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("creates nodes for each service", () => {
    const trace = makeTrace({
      spans: [
        makeSpan({ spanId: "a", serviceName: "frontend" }),
        makeSpan({ spanId: "b", serviceName: "backend", parentSpanId: "a" }),
      ],
    });
    const graph = buildServiceGraph([trace]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["backend", "frontend"]);
  });

  it("creates edges between different services", () => {
    const trace = makeTrace({
      spans: [
        makeSpan({ spanId: "a", serviceName: "frontend" }),
        makeSpan({ spanId: "b", serviceName: "backend", parentSpanId: "a" }),
      ],
    });
    const graph = buildServiceGraph([trace]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      source: "frontend",
      target: "backend",
      callCount: 1,
    });
  });

  it("does not create edges within the same service", () => {
    const trace = makeTrace({
      spans: [
        makeSpan({ spanId: "a", serviceName: "frontend" }),
        makeSpan({ spanId: "b", serviceName: "frontend", parentSpanId: "a" }),
      ],
    });
    const graph = buildServiceGraph([trace]);
    expect(graph.edges).toHaveLength(0);
  });

  it("accumulates call counts across traces", () => {
    const t1 = makeTrace({
      traceId: "t1",
      spans: [
        makeSpan({ traceId: "t1", spanId: "a", serviceName: "web" }),
        makeSpan({ traceId: "t1", spanId: "b", serviceName: "api", parentSpanId: "a" }),
      ],
    });
    const t2 = makeTrace({
      traceId: "t2",
      spans: [
        makeSpan({ traceId: "t2", spanId: "c", serviceName: "web" }),
        makeSpan({ traceId: "t2", spanId: "d", serviceName: "api", parentSpanId: "c" }),
      ],
    });
    const graph = buildServiceGraph([t1, t2]);
    expect(graph.edges[0].callCount).toBe(2);
  });

  it("counts errors per service", () => {
    const trace = makeTrace({
      spans: [
        makeSpan({ spanId: "a", serviceName: "frontend", statusCode: "Ok" }),
        makeSpan({ spanId: "b", serviceName: "backend", statusCode: "Error", parentSpanId: "a" }),
      ],
    });
    const graph = buildServiceGraph([trace]);
    const backend = graph.nodes.find((n) => n.id === "backend");
    expect(backend?.errorCount).toBe(1);
  });
});
