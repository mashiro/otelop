import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { Graph } from "@visx/network";
import { ParentSize } from "@visx/responsive";
import { tracesAtom } from "@/stores/telemetry";
import { buildServiceGraph } from "@/lib/service-graph";

const NODE_RADIUS_BASE = 20;
const NODE_RADIUS_MAX = 40;

interface LayoutNode {
  x: number;
  y: number;
  id: string;
  spanCount: number;
  errorCount: number;
  radius: number;
}

interface LayoutLink {
  source: LayoutNode;
  target: LayoutNode;
  callCount: number;
}

interface LayoutGraph {
  nodes: LayoutNode[];
  links: LayoutLink[];
}

function computeLayout(
  graph: ReturnType<typeof buildServiceGraph>,
  width: number,
  height: number,
): LayoutGraph {
  const cx = width / 2;
  const cy = height / 2;
  const maxSpans = Math.max(...graph.nodes.map((n) => n.spanCount), 1);
  const layoutRadius = Math.min(width, height) / 2 - 80;

  const nodes: LayoutNode[] = graph.nodes.map((node, i) => {
    const angle =
      graph.nodes.length === 1 ? 0 : (2 * Math.PI * i) / graph.nodes.length - Math.PI / 2;
    const r = graph.nodes.length === 1 ? 0 : layoutRadius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      id: node.id,
      spanCount: node.spanCount,
      errorCount: node.errorCount,
      radius: NODE_RADIUS_BASE + (node.spanCount / maxSpans) * (NODE_RADIUS_MAX - NODE_RADIUS_BASE),
    };
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const links: LayoutLink[] = graph.edges
    .map((edge) => ({
      source: nodeById.get(edge.source)!,
      target: nodeById.get(edge.target)!,
      callCount: edge.callCount,
    }))
    .filter((l) => l.source && l.target);

  return { nodes, links };
}

export function ServiceMap() {
  return (
    <ParentSize>
      {({ width, height }) =>
        width > 0 && height > 0 ? <ServiceMapInner width={width} height={height} /> : null
      }
    </ParentSize>
  );
}

function ServiceMapInner({ width, height }: { width: number; height: number }) {
  const traces = useAtomValue(tracesAtom);
  const graph = useMemo(() => buildServiceGraph(traces), [traces]);
  const layout = useMemo(() => computeLayout(graph, width, height), [graph, width, height]);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">No service data available</p>
      </div>
    );
  }

  return (
    <svg width={width} height={height}>
      <defs>
        <marker
          id="arrowhead"
          viewBox="0 0 10 7"
          refX="10"
          refY="3.5"
          markerWidth="8"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="var(--muted-foreground)" opacity={0.6} />
        </marker>
      </defs>
      <Graph
        graph={layout}
        linkComponent={({ link }) => {
          const dx = link.target.x - link.source.x;
          const dy = link.target.y - link.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / dist;
          const uy = dy / dist;
          const x1 = link.source.x + ux * link.source.radius;
          const y1 = link.source.y + uy * link.source.radius;
          const x2 = link.target.x - ux * (link.target.radius + 8);
          const y2 = link.target.y - uy * (link.target.radius + 8);
          return (
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="var(--muted-foreground)"
              strokeWidth={Math.min(1 + link.callCount * 0.5, 5)}
              opacity={0.4}
              markerEnd="url(#arrowhead)"
            />
          );
        }}
        nodeComponent={({ node }) => {
          const hasErrors = node.errorCount > 0;
          return (
            <g>
              <circle
                r={node.radius}
                fill="var(--card)"
                stroke={hasErrors ? "var(--destructive)" : "var(--trace)"}
                strokeWidth={hasErrors ? 2 : 1.5}
                opacity={0.9}
              />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                fontFamily="var(--font-sans)"
                fontWeight="600"
                fill="var(--foreground)"
                className="select-none"
              >
                {node.id.length > 14 ? `${node.id.slice(0, 12)}…` : node.id}
              </text>
              <text
                y={node.radius + 14}
                textAnchor="middle"
                fontSize={10}
                fontFamily="var(--font-mono)"
                fill="var(--muted-foreground)"
                className="select-none"
              >
                {node.spanCount} spans
              </text>
            </g>
          );
        }}
      />
    </svg>
  );
}
