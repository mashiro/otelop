import type { TraceData, SpanData } from "@/types/telemetry";

export interface ServiceNode {
  id: string;
  spanCount: number;
  errorCount: number;
}

export interface ServiceEdge {
  source: string;
  target: string;
  callCount: number;
}

export interface ServiceGraph {
  nodes: ServiceNode[];
  edges: ServiceEdge[];
}

export function buildServiceGraph(traces: TraceData[]): ServiceGraph {
  const nodeMap = new Map<string, ServiceNode>();
  const edgeMap = new Map<string, ServiceEdge>();

  for (const trace of traces) {
    const spanById = new Map<string, SpanData>();
    for (const span of trace.spans) {
      spanById.set(span.spanID, span);
      const node = nodeMap.get(span.serviceName) ?? {
        id: span.serviceName,
        spanCount: 0,
        errorCount: 0,
      };
      node.spanCount++;
      if (span.statusCode === "Error") node.errorCount++;
      nodeMap.set(span.serviceName, node);
    }
    for (const span of trace.spans) {
      if (!span.parentSpanID) continue;
      const parent = spanById.get(span.parentSpanID);
      if (!parent || parent.serviceName === span.serviceName) continue;
      const key = `${parent.serviceName}->${span.serviceName}`;
      const edge = edgeMap.get(key) ?? {
        source: parent.serviceName,
        target: span.serviceName,
        callCount: 0,
      };
      edge.callCount++;
      edgeMap.set(key, edge);
    }
  }
  return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
}
