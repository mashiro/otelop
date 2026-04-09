import { useMemo } from "react";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDuration } from "@/lib/format";
import type { TraceData, SpanData } from "@/types/telemetry";

const ROW_HEIGHT = 28;
const LABEL_WIDTH = 250;
const BAR_PADDING = 2;
const MIN_BAR_WIDTH = 2;

// Service name → color mapping
const SERVICE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

interface Props {
  trace: TraceData;
  onSelectSpan: (span: SpanData) => void;
  selectedSpan: SpanData | null;
}

interface FlatSpan {
  span: SpanData;
  depth: number;
}

function buildTree(spans: SpanData[]): FlatSpan[] {
  const byId = new Map<string, SpanData>();
  const children = new Map<string, SpanData[]>();

  for (const s of spans) {
    byId.set(s.spanID, s);
    const parentID = s.parentSpanID || "";
    if (!children.has(parentID)) children.set(parentID, []);
    children.get(parentID)!.push(s);
  }

  const result: FlatSpan[] = [];
  function walk(parentID: string, depth: number) {
    const kids = children.get(parentID) ?? [];
    kids.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    for (const s of kids) {
      result.push({ span: s, depth });
      walk(s.spanID, depth + 1);
    }
  }

  // Find roots (no parent or parent not in set)
  const roots = spans.filter((s) => !s.parentSpanID || !byId.has(s.parentSpanID));
  roots.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  for (const r of roots) {
    result.push({ span: r, depth: 0 });
    walk(r.spanID, 1);
  }

  return result;
}

export function SpanWaterfall({ trace, onSelectSpan, selectedSpan }: Props) {
  return (
    <ParentSize>
      {({ width, height }) =>
        width > 0 ? (
          <WaterfallInner
            trace={trace}
            width={width}
            height={height}
            onSelectSpan={onSelectSpan}
            selectedSpan={selectedSpan}
          />
        ) : null
      }
    </ParentSize>
  );
}

function WaterfallInner({
  trace,
  width,
  height,
  onSelectSpan,
  selectedSpan,
}: Props & { width: number; height: number }) {
  const flatSpans = useMemo(() => buildTree(trace.spans), [trace.spans]);

  const serviceColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const services = [...new Set(flatSpans.map((f) => f.span.serviceName))];
    services.forEach((s, i) => map.set(s, SERVICE_COLORS[i % SERVICE_COLORS.length]));
    return map;
  }, [flatSpans]);

  const traceStart = useMemo(() => {
    let min = Infinity;
    for (const f of flatSpans) {
      const t = new Date(f.span.startTime).getTime();
      if (t < min) min = t;
    }
    return min;
  }, [flatSpans]);

  const traceEnd = useMemo(() => {
    let max = -Infinity;
    for (const f of flatSpans) {
      const t = new Date(f.span.endTime).getTime();
      if (t > max) max = t;
    }
    return max;
  }, [flatSpans]);

  const barWidth = width - LABEL_WIDTH;
  const xScale = scaleLinear({
    domain: [traceStart, traceEnd],
    range: [0, barWidth],
  });

  const svgHeight = Math.max(flatSpans.length * ROW_HEIGHT, height);

  return (
    <ScrollArea className="h-full">
      <svg width={width} height={svgHeight}>
        {flatSpans.map((f, i) => {
          const startMs = new Date(f.span.startTime).getTime();
          const endMs = new Date(f.span.endTime).getTime();
          const x = xScale(startMs);
          const w = Math.max(xScale(endMs) - x, MIN_BAR_WIDTH);
          const y = i * ROW_HEIGHT;
          const isSelected = selectedSpan?.spanID === f.span.spanID;
          const isError = f.span.statusCode === "Error";
          const color = isError ? "var(--destructive)" : serviceColorMap.get(f.span.serviceName)!;

          return (
            <Group
              key={f.span.spanID}
              top={y}
              className="cursor-pointer"
              onClick={() => onSelectSpan(f.span)}
            >
              {isSelected && (
                <rect
                  x={0}
                  y={0}
                  width={width}
                  height={ROW_HEIGHT}
                  fill="var(--accent)"
                  opacity={0.3}
                />
              )}
              {/* Label */}
              <text
                x={8 + f.depth * 16}
                y={ROW_HEIGHT / 2}
                dominantBaseline="central"
                fontSize={11}
                fill="var(--foreground)"
                className="select-none"
              >
                {truncate(
                  `${f.span.serviceName}: ${f.span.name}`,
                  Math.floor((LABEL_WIDTH - 8 - f.depth * 16) / 6),
                )}
              </text>
              {/* Bar */}
              <rect
                x={LABEL_WIDTH + x}
                y={BAR_PADDING}
                width={w}
                height={ROW_HEIGHT - BAR_PADDING * 2}
                rx={2}
                fill={color}
                opacity={0.8}
              />
              {/* Duration label on bar */}
              {w > 40 && (
                <text
                  x={LABEL_WIDTH + x + w / 2}
                  y={ROW_HEIGHT / 2}
                  dominantBaseline="central"
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--primary-foreground)"
                  className="select-none"
                >
                  {formatDuration(f.span.duration)}
                </text>
              )}
              {/* Separator line */}
              <line
                x1={0}
                x2={width}
                y1={ROW_HEIGHT}
                y2={ROW_HEIGHT}
                stroke="var(--border)"
                strokeWidth={0.5}
              />
            </Group>
          );
        })}
      </svg>
    </ScrollArea>
  );
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(maxLen - 1, 0)) + "…";
}
