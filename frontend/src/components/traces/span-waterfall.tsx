import { useMemo } from "react";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { Temporal } from "temporal-polyfill";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDuration } from "@/lib/format";
import type { TraceData, SpanData } from "@/types/telemetry";

const ROW_HEIGHT = 32;
const LABEL_WIDTH = 260;
const BAR_PADDING = 4;
const MIN_BAR_WIDTH = 3;

const SERVICE_COLORS = [
  "oklch(0.80 0.14 195)",
  "oklch(0.82 0.14 80)",
  "oklch(0.78 0.14 300)",
  "oklch(0.78 0.17 155)",
  "oklch(0.75 0.18 15)",
  "oklch(0.80 0.12 230)",
  "oklch(0.76 0.14 50)",
  "oklch(0.74 0.16 340)",
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

/** Parse ISO timestamp to nanoseconds relative to a base instant. */
function toNsOffset(iso: string, baseNs: bigint): number {
  try {
    const ns = Temporal.Instant.from(iso).epochNanoseconds;
    return Number(ns - baseNs);
  } catch {
    return -1;
  }
}

function compareByStartTime(a: SpanData, b: SpanData): number {
  try {
    return Temporal.Instant.compare(
      Temporal.Instant.from(a.startTime),
      Temporal.Instant.from(b.startTime),
    );
  } catch {
    return 0;
  }
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
    kids.sort(compareByStartTime);
    for (const s of kids) {
      result.push({ span: s, depth });
      walk(s.spanID, depth + 1);
    }
  }

  const roots = spans.filter((s) => !s.parentSpanID || !byId.has(s.parentSpanID));
  roots.sort(compareByStartTime);
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

  // Compute scale in nanoseconds, anchored to the root span so it fills full width.
  const { baseNs, totalNs } = useMemo(() => {
    // Prefer root span: its start → end defines the full width.
    if (trace.rootSpan) {
      try {
        const start = Temporal.Instant.from(trace.rootSpan.startTime).epochNanoseconds;
        const end = Temporal.Instant.from(trace.rootSpan.endTime).epochNanoseconds;
        const dur = Number(end - start);
        if (dur > 0) return { baseNs: start, totalNs: dur };
      } catch { /* fall through */ }
    }
    // Fallback: trace.startTime + trace.duration (duration is already in ns).
    try {
      const start = Temporal.Instant.from(trace.startTime).epochNanoseconds;
      if (trace.duration > 0) return { baseNs: start, totalNs: trace.duration };
    } catch { /* fall through */ }
    // Last resort: compute from all spans.
    let minNs: bigint | null = null;
    let maxNs: bigint | null = null;
    for (const f of flatSpans) {
      try {
        const s = Temporal.Instant.from(f.span.startTime).epochNanoseconds;
        const e = Temporal.Instant.from(f.span.endTime).epochNanoseconds;
        if (minNs === null || s < minNs) minNs = s;
        if (maxNs === null || e > maxNs) maxNs = e;
      } catch { /* skip */ }
    }
    if (minNs !== null && maxNs !== null && maxNs > minNs) {
      return { baseNs: minNs, totalNs: Number(maxNs - minNs) };
    }
    return { baseNs: 0n, totalNs: 1 };
  }, [trace.rootSpan, trace.startTime, trace.duration, flatSpans]);

  const barWidth = width - LABEL_WIDTH;
  const xScale = scaleLinear({
    domain: [0, totalNs],
    range: [0, barWidth],
  });

  const svgHeight = Math.max(flatSpans.length * ROW_HEIGHT, height);

  return (
    <ScrollArea className="h-full">
      <svg width={width} height={svgHeight}>
        <defs>
          {[...serviceColorMap.entries()].map(([service, color]) => (
            <linearGradient key={service} id={`grad-${service.replace(/\W/g, "")}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} stopOpacity="0.9" />
              <stop offset="100%" stopColor={color} stopOpacity="0.6" />
            </linearGradient>
          ))}
          <linearGradient id="grad-error" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.70 0.22 25)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="oklch(0.70 0.22 25)" stopOpacity="0.6" />
          </linearGradient>
          <filter id="bar-glow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {flatSpans.map((f, i) => {
          const startOffset = toNsOffset(f.span.startTime, baseNs);
          // Use duration field for width (always accurate in ns).
          const spanDurNs = f.span.duration > 0 ? f.span.duration : 0;
          const x = xScale(Math.max(startOffset, 0));
          const w = Math.max(xScale(spanDurNs) - xScale(0), MIN_BAR_WIDTH);
          const y = i * ROW_HEIGHT;
          const isSelected = selectedSpan?.spanID === f.span.spanID;
          const isError = f.span.statusCode === "Error";
          const serviceKey = f.span.serviceName.replace(/\W/g, "");
          const gradId = isError ? "grad-error" : `grad-${serviceKey}`;
          const color = isError ? "oklch(0.70 0.22 25)" : serviceColorMap.get(f.span.serviceName)!;

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
                  fill={color}
                  opacity={0.08}
                />
              )}

              <rect
                x={0}
                y={0}
                width={width}
                height={ROW_HEIGHT}
                fill="transparent"
                className="opacity-0 transition-opacity hover:opacity-100"
              />

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
                <title>{`${f.span.serviceName}: ${f.span.name}`}</title>
                {truncate(
                  f.span.name,
                  Math.floor((LABEL_WIDTH - 8 - f.depth * 16) / 6),
                )}
              </text>

              <rect
                x={LABEL_WIDTH + x}
                y={BAR_PADDING}
                width={w}
                height={ROW_HEIGHT - BAR_PADDING * 2}
                rx={3}
                fill={`url(#${gradId})`}
                filter={isSelected ? "url(#bar-glow)" : undefined}
              />

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
