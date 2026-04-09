import { useMemo } from "react";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDuration } from "@/lib/format";
import type { TraceData, SpanData } from "@/types/telemetry";

const ROW_HEIGHT = 32;
const LABEL_WIDTH = 260;
const BAR_PADDING = 4;
const MIN_BAR_WIDTH = 3;

const SERVICE_COLORS = [
  "oklch(0.75 0.14 195)",
  "oklch(0.78 0.14 80)",
  "oklch(0.72 0.14 300)",
  "oklch(0.72 0.17 155)",
  "oklch(0.70 0.18 15)",
  "oklch(0.75 0.12 230)",
  "oklch(0.70 0.14 50)",
  "oklch(0.68 0.16 340)",
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
        <defs>
          {/* Gradient definitions for each service */}
          {[...serviceColorMap.entries()].map(([service, color]) => (
            <linearGradient key={service} id={`grad-${service.replace(/\W/g, "")}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} stopOpacity="0.9" />
              <stop offset="100%" stopColor={color} stopOpacity="0.6" />
            </linearGradient>
          ))}
          <linearGradient id="grad-error" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.65 0.22 25)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="oklch(0.65 0.22 25)" stopOpacity="0.6" />
          </linearGradient>
          {/* Glow filter */}
          <filter id="bar-glow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {flatSpans.map((f, i) => {
          const startMs = new Date(f.span.startTime).getTime();
          const endMs = new Date(f.span.endTime).getTime();
          const x = xScale(startMs);
          const w = Math.max(xScale(endMs) - x, MIN_BAR_WIDTH);
          const y = i * ROW_HEIGHT;
          const isSelected = selectedSpan?.spanID === f.span.spanID;
          const isError = f.span.statusCode === "Error";
          const serviceKey = f.span.serviceName.replace(/\W/g, "");
          const gradId = isError ? "grad-error" : `grad-${serviceKey}`;
          const color = isError ? "oklch(0.65 0.22 25)" : serviceColorMap.get(f.span.serviceName)!;

          return (
            <Group
              key={f.span.spanID}
              top={y}
              className="cursor-pointer"
              onClick={() => onSelectSpan(f.span)}
            >
              {/* Selected row highlight */}
              {isSelected && (
                <rect
                  x={0}
                  y={0}
                  width={width}
                  height={ROW_HEIGHT}
                  fill={color}
                  opacity={0.08}
                />
              )}

              {/* Hover area */}
              <rect
                x={0}
                y={0}
                width={width}
                height={ROW_HEIGHT}
                fill="transparent"
                className="opacity-0 transition-opacity hover:opacity-100"
              />

              {/* Depth indicator lines */}
              {f.depth > 0 && (
                <line
                  x1={8 + (f.depth - 1) * 16 + 4}
                  y1={0}
                  x2={8 + (f.depth - 1) * 16 + 4}
                  y2={ROW_HEIGHT}
                  stroke={color}
                  strokeWidth={1}
                  opacity={0.15}
                />
              )}

              {/* Label */}
              <text
                x={8 + f.depth * 16}
                y={ROW_HEIGHT / 2}
                dominantBaseline="central"
                fontSize={11}
                fontFamily="var(--font-sans)"
                fill="var(--foreground)"
                opacity={isSelected ? 1 : 0.8}
                className="select-none"
              >
                {truncate(
                  `${f.span.serviceName}: ${f.span.name}`,
                  Math.floor((LABEL_WIDTH - 8 - f.depth * 16) / 6),
                )}
              </text>

              {/* Bar with gradient */}
              <rect
                x={LABEL_WIDTH + x}
                y={BAR_PADDING}
                width={w}
                height={ROW_HEIGHT - BAR_PADDING * 2}
                rx={3}
                fill={`url(#${gradId})`}
                filter={isSelected ? "url(#bar-glow)" : undefined}
              />

              {/* Duration label on bar */}
              {w > 50 && (
                <text
                  x={LABEL_WIDTH + x + w / 2}
                  y={ROW_HEIGHT / 2}
                  dominantBaseline="central"
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                  fontWeight="500"
                  fill="white"
                  opacity={0.9}
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
                opacity={0.5}
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
  return s.slice(0, Math.max(maxLen - 1, 0)) + "\u2026";
}
