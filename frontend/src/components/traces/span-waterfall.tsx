import { useCallback, useMemo, useRef } from "react";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { ParentSize } from "@visx/responsive";
import { Temporal } from "temporal-polyfill";
import { useTooltip, TooltipWithBounds } from "@visx/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDuration, createDurationFormatter } from "@/lib/format";
import type { TraceData, SpanData } from "@/types/telemetry";

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 28;
const LABEL_WIDTH = 260;
const BAR_PADDING = 8;
const MIN_BAR_WIDTH = 3;
const INDENT_BASE = 8;
const INDENT_PER_DEPTH = 16;
const SERVICE_BAR_WIDTH = 4;
const SERVICE_GAP = 6;
const AVG_CHAR_WIDTH = 6;
const TICK_COUNT = 5;
const ERROR_COLOR = "oklch(0.70 0.22 25)";

const SERVICE_COLORS = [
  "oklch(0.65 0.14 195)",
  "oklch(0.67 0.14 80)",
  "oklch(0.63 0.14 300)",
  "oklch(0.63 0.17 155)",
  "oklch(0.60 0.18 15)",
  "oklch(0.65 0.12 230)",
  "oklch(0.61 0.14 50)",
  "oklch(0.59 0.16 340)",
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

interface TooltipData {
  service: string;
  name: string;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const flatSpans = useMemo(() => buildTree(trace.spans), [trace.spans]);

  const serviceColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const services = [...new Set(flatSpans.map((f) => f.span.serviceName))];
    services.forEach((s, i) => map.set(s, SERVICE_COLORS[i % SERVICE_COLORS.length]));
    return map;
  }, [flatSpans]);

  const { baseNs, totalNs } = useMemo(() => {
    if (trace.rootSpan) {
      try {
        const start = Temporal.Instant.from(trace.rootSpan.startTime).epochNanoseconds;
        const end = Temporal.Instant.from(trace.rootSpan.endTime).epochNanoseconds;
        const dur = Number(end - start);
        if (dur > 0) return { baseNs: start, totalNs: dur };
      } catch {
        /* fall through */
      }
    }
    try {
      const start = Temporal.Instant.from(trace.startTime).epochNanoseconds;
      if (trace.duration > 0) return { baseNs: start, totalNs: trace.duration };
    } catch {
      /* fall through */
    }
    let minNs: bigint | null = null;
    let maxNs: bigint | null = null;
    for (const f of flatSpans) {
      try {
        const s = Temporal.Instant.from(f.span.startTime).epochNanoseconds;
        const e = Temporal.Instant.from(f.span.endTime).epochNanoseconds;
        if (minNs === null || s < minNs) minNs = s;
        if (maxNs === null || e > maxNs) maxNs = e;
      } catch {
        /* skip */
      }
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

  const formatTick = useMemo(() => createDurationFormatter(totalNs), [totalNs]);

  const ticks = useMemo(() => {
    const result = [];
    for (let i = 0; i <= TICK_COUNT; i++) {
      const ns = (totalNs / TICK_COUNT) * i;
      result.push({ ns, x: xScale(ns), isLast: i === TICK_COUNT });
    }
    return result;
  }, [totalNs, xScale]);

  const svgHeight = Math.max(flatSpans.length * ROW_HEIGHT + HEADER_HEIGHT, height);

  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
    useTooltip<TooltipData>();

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent, span: SpanData) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      showTooltip({
        tooltipData: { service: span.serviceName, name: span.name },
        tooltipLeft: e.clientX - rect.left,
        tooltipTop: e.clientY - rect.top,
      });
    },
    [showTooltip],
  );

  return (
    <div ref={containerRef} className="relative h-full">
      <ScrollArea className="h-full">
        <svg width={width} height={svgHeight}>
          <defs>
            {[...serviceColorMap.entries()].map(([service, color]) => (
              <linearGradient
                key={service}
                id={`grad-${service.replace(/\W/g, "")}`}
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                <stop offset="0%" stopColor={color} stopOpacity="0.9" />
                <stop offset="100%" stopColor={color} stopOpacity="0.6" />
              </linearGradient>
            ))}
            <linearGradient id="grad-error" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={ERROR_COLOR} stopOpacity="0.9" />
              <stop offset="100%" stopColor={ERROR_COLOR} stopOpacity="0.6" />
            </linearGradient>
            <filter id="bar-glow" x="-20%" y="-50%" width="140%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Timeline header */}
          <Group top={0}>
            <rect
              x={0}
              y={0}
              width={width}
              height={HEADER_HEIGHT}
              fill="var(--muted-foreground)"
              opacity={0.1}
            />
            <text
              x={INDENT_BASE}
              y={HEADER_HEIGHT / 2}
              dominantBaseline="central"
              fontSize={11}
              fontFamily="var(--font-sans)"
              fontWeight="600"
              fill="var(--muted-foreground)"
              className="select-none"
            >
              Operation
            </text>
            {ticks.map((tick) => (
              <Group key={tick.ns} left={LABEL_WIDTH + tick.x}>
                <line
                  x1={0}
                  y1={0}
                  x2={0}
                  y2={HEADER_HEIGHT}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={tick.isLast ? -4 : 4}
                  y={HEADER_HEIGHT / 2}
                  dominantBaseline="central"
                  textAnchor={tick.isLast ? "end" : "start"}
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                  fill="var(--muted-foreground)"
                  className="select-none"
                >
                  {formatTick(tick.ns)}
                </text>
              </Group>
            ))}
            <line
              x1={0}
              y1={HEADER_HEIGHT}
              x2={width}
              y2={HEADER_HEIGHT}
              stroke="var(--border)"
              strokeWidth={1}
            />
          </Group>

          {/* Bar area background & divider */}
          <rect
            x={LABEL_WIDTH}
            y={HEADER_HEIGHT}
            width={width - LABEL_WIDTH}
            height={svgHeight - HEADER_HEIGHT}
            fill="var(--muted)"
            opacity={0.3}
          />
          <line
            x1={LABEL_WIDTH}
            y1={HEADER_HEIGHT}
            x2={LABEL_WIDTH}
            y2={svgHeight}
            stroke="var(--border)"
            strokeWidth={1}
          />
          {/* Tick grid lines */}
          {ticks.map((tick) => (
            <line
              key={tick.ns}
              x1={LABEL_WIDTH + tick.x}
              y1={HEADER_HEIGHT}
              x2={LABEL_WIDTH + tick.x}
              y2={svgHeight}
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}

          {flatSpans.map((f, i) => {
            const startOffset = toNsOffset(f.span.startTime, baseNs);
            const spanDurNs = f.span.duration > 0 ? f.span.duration : 0;
            const x = xScale(Math.max(startOffset, 0));
            const w = Math.max(xScale(spanDurNs) - xScale(0), MIN_BAR_WIDTH);
            const y = i * ROW_HEIGHT + HEADER_HEIGHT;
            const isSelected = selectedSpan?.spanID === f.span.spanID;
            const isError = f.span.statusCode === "Error";
            const serviceKey = f.span.serviceName.replace(/\W/g, "");
            const gradId = isError ? "grad-error" : `grad-${serviceKey}`;
            const color = isError ? ERROR_COLOR : serviceColorMap.get(f.span.serviceName)!;
            const labelX =
              INDENT_BASE + f.depth * INDENT_PER_DEPTH + SERVICE_BAR_WIDTH + SERVICE_GAP;
            const availChars = Math.floor((LABEL_WIDTH - labelX) / AVG_CHAR_WIDTH);
            const durLabel = formatDuration(f.span.duration);

            return (
              <Group
                key={f.span.spanID}
                top={y}
                className="cursor-pointer"
                onClick={() => onSelectSpan(f.span)}
              >
                {isSelected && (
                  <rect x={0} y={0} width={width} height={ROW_HEIGHT} fill={color} opacity={0.08} />
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
                    x1={INDENT_BASE + (f.depth - 1) * INDENT_PER_DEPTH + 4}
                    y1={0}
                    x2={INDENT_BASE + (f.depth - 1) * INDENT_PER_DEPTH + 4}
                    y2={ROW_HEIGHT}
                    stroke={color}
                    strokeWidth={1}
                    opacity={0.15}
                  />
                )}

                {/* Service color indicator */}
                <rect
                  x={INDENT_BASE + f.depth * INDENT_PER_DEPTH}
                  y={ROW_HEIGHT / 2 - 6}
                  width={SERVICE_BAR_WIDTH}
                  height={12}
                  rx={1}
                  fill={color}
                />

                {/* Operation name */}
                <text
                  x={labelX}
                  y={ROW_HEIGHT / 2}
                  dominantBaseline="central"
                  fontSize={11}
                  fontFamily="var(--font-sans)"
                  fill="var(--foreground)"
                  opacity={isSelected ? 1 : 0.8}
                  className="select-none"
                  onMouseEnter={(e) => handleMouseEnter(e, f.span)}
                  onMouseLeave={hideTooltip}
                >
                  {truncate(f.span.name, availChars)}
                </text>

                {/* Bar */}
                <rect
                  x={LABEL_WIDTH + x}
                  y={BAR_PADDING}
                  width={w}
                  height={ROW_HEIGHT - BAR_PADDING * 2}
                  rx={3}
                  fill={`url(#${gradId})`}
                  filter={isSelected ? "url(#bar-glow)" : undefined}
                />

                {/* Duration label: inside bar if fits, otherwise to the right */}
                {w > 50 ? (
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
                    {durLabel}
                  </text>
                ) : (
                  <text
                    x={LABEL_WIDTH + x + w + 4}
                    y={ROW_HEIGHT / 2}
                    dominantBaseline="central"
                    textAnchor="start"
                    fontSize={10}
                    fontFamily="var(--font-mono)"
                    fontWeight="500"
                    fill="var(--muted-foreground)"
                    className="select-none"
                  >
                    {durLabel}
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

      {tooltipOpen && tooltipData && (
        <TooltipWithBounds
          left={tooltipLeft}
          top={tooltipTop}
          unstyled
          applyPositionStyle
          className="pointer-events-none z-50 flex flex-col items-center gap-0.5 whitespace-nowrap rounded-md bg-accent px-3 py-1.5 text-xs text-foreground shadow-sm"
        >
          <span className="opacity-60">{tooltipData.service}</span>
          <span>{tooltipData.name}</span>
        </TooltipWithBounds>
      )}
    </div>
  );
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(maxLen - 1, 0)) + "\u2026";
}
