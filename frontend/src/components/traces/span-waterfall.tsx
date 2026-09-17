import { useMemo, useState } from "react";
import { useParentSize } from "@visx/responsive";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDuration, createDurationFormatter } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TraceData, SpanData } from "@/types/telemetry";

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

export interface FlatSpan {
  span: SpanData;
  depth: number;
  hasChildren: boolean;
}

/** Offset of a span's pre-parsed start epoch relative to a base instant. */
function toNsOffset(startEpochNs: bigint, baseNs: bigint): number {
  return Number(startEpochNs - baseNs);
}

function compareByStartTime(a: SpanData, b: SpanData): number {
  if (a.startEpochNs < b.startEpochNs) return -1;
  if (a.startEpochNs > b.startEpochNs) return 1;
  return 0;
}

export function buildTree(spans: SpanData[]): FlatSpan[] {
  const byId = new Map<string, SpanData>();
  const children = new Map<string, SpanData[]>();

  for (const s of spans) {
    byId.set(s.spanId, s);
    const parentId = s.parentSpanId || "";
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId)!.push(s);
  }

  const result: FlatSpan[] = [];
  function walk(parentId: string, depth: number) {
    const kids = children.get(parentId) ?? [];
    kids.sort(compareByStartTime);
    for (const s of kids) {
      const hasKids = (children.get(s.spanId)?.length ?? 0) > 0;
      result.push({ span: s, depth, hasChildren: hasKids });
      walk(s.spanId, depth + 1);
    }
  }

  const roots = spans.filter((s) => !s.parentSpanId || !byId.has(s.parentSpanId));
  roots.sort(compareByStartTime);
  for (const r of roots) {
    const hasKids = (children.get(r.spanId)?.length ?? 0) > 0;
    result.push({ span: r, depth: 0, hasChildren: hasKids });
    walk(r.spanId, 1);
  }

  return result;
}

export function SpanWaterfall(props: Props) {
  const { parentRef, width } = useParentSize();

  return (
    <div ref={parentRef} className="h-full">
      {width > 0 && <WaterfallInner key={props.trace.traceId} {...props} width={width} />}
    </div>
  );
}

function WaterfallInner({ trace, onSelectSpan, selectedSpan, width }: Props & { width: number }) {
  const flatSpans = useMemo(() => buildTree(trace.spans), [trace.spans]);
  const [hoveredSpanId, setHoveredSpanId] = useState<string | null>(null);
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set());
  const visibleSpans = useMemo(() => {
    const result: FlatSpan[] = [];
    let skipDepth: number | null = null;
    for (const f of flatSpans) {
      if (skipDepth !== null && f.depth > skipDepth) continue;
      skipDepth = null;
      result.push(f);
      if (collapsedSet.has(f.span.spanId)) skipDepth = f.depth;
    }
    return result;
  }, [flatSpans, collapsedSet]);
  const serviceColorMap = useMemo(() => {
    const services = [...new Set(flatSpans.map((f) => f.span.serviceName))];
    return new Map(
      services.map((service, i) => [service, SERVICE_COLORS[i % SERVICE_COLORS.length]]),
    );
  }, [flatSpans]);
  const { baseNs, totalNs } = useMemo(() => {
    // The representative root may not cover later roots in a multi-root trace.
    if (trace.duration > 0) return { baseNs: trace.startEpochNs, totalNs: trace.duration };
    let minNs: bigint | null = null;
    let maxNs: bigint | null = null;
    for (const { span } of flatSpans) {
      if (minNs === null || span.startEpochNs < minNs) minNs = span.startEpochNs;
      if (maxNs === null || span.endEpochNs > maxNs) maxNs = span.endEpochNs;
    }
    return minNs !== null && maxNs !== null && maxNs > minNs
      ? { baseNs: minNs, totalNs: Number(maxNs - minNs) }
      : { baseNs: 0n, totalNs: 1 };
  }, [trace.startEpochNs, trace.duration, flatSpans]);
  const formatTick = createDurationFormatter(totalNs);
  const labelWidth = Math.min(260, Math.max(170, width * 0.5));
  const timelineWidth = width - labelWidth;
  const tickCount = 5;
  const gridTemplateColumns = `${labelWidth}px minmax(0, 1fr)`;

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Trace waterfall">
      <div
        className="grid h-7 shrink-0 border-b border-border text-[10px] text-muted-foreground"
        style={{
          gridTemplateColumns,
          background: "color-mix(in srgb, var(--muted-foreground) 10%, transparent)",
        }}
      >
        <span className="flex items-center px-2 text-[11px] font-semibold">Operation</span>
        <div className="relative font-mono">
          {Array.from({ length: tickCount + 1 }, (_, i) => (
            <div
              key={i}
              className="absolute inset-y-0"
              style={{ left: `${(i / tickCount) * 100}%` }}
            >
              <span
                className="absolute inset-y-0 border-l border-border"
                style={{ transform: i === tickCount ? "translateX(-100%)" : undefined }}
              />
              <span
                className="absolute top-1/2 px-1 font-mono whitespace-nowrap"
                style={{
                  transform: `translate(${i === tickCount ? "-100%" : "0"}, -50%)`,
                }}
              >
                {formatTick((totalNs * i) / tickCount)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" aria-label="Span rows">
        <div className="grid min-h-full" style={{ gridTemplateColumns }}>
          <ScrollAreaPrimitive.Root className="relative flex min-w-0 flex-col">
            <ScrollAreaPrimitive.Viewport
              aria-label="Span tree"
              className="flex-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <ScrollAreaPrimitive.Content className="w-max min-w-full! pb-3">
                {visibleSpans.map(({ span, depth, hasChildren }) => {
                  const isSelected = selectedSpan?.spanId === span.spanId;
                  const isError = span.statusCode === "Error";
                  const color = isError ? ERROR_COLOR : serviceColorMap.get(span.serviceName)!;
                  const indent = depth * 16;
                  return (
                    <div
                      key={span.spanId}
                      className="relative h-8"
                      onMouseEnter={() => setHoveredSpanId(span.spanId)}
                      onMouseLeave={() => setHoveredSpanId(null)}
                    >
                      {depth > 0 && (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 w-px"
                          style={{ left: 20 + (depth - 1) * 16, background: color, opacity: 0.15 }}
                        />
                      )}
                      <Tooltip>
                        <TooltipTrigger
                          delay={0}
                          type="button"
                          aria-label={`${span.name}, ${span.serviceName}, ${formatDuration(span.duration)}${isError ? ", Error" : ""}`}
                          aria-pressed={isSelected}
                          onClick={() => onSelectSpan(span)}
                          className={cn(
                            "flex h-full w-full cursor-pointer items-center gap-1.5 transition-colors pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            hoveredSpanId === span.spanId && "bg-trace/5",
                          )}
                          style={{
                            paddingLeft: 36 + indent,
                            background: isSelected
                              ? `color-mix(in oklch, ${color} 8%, transparent)`
                              : undefined,
                          }}
                        >
                          <span
                            className="h-3 w-1 shrink-0 rounded-[1px]"
                            style={{ background: color }}
                          />
                          <span
                            className={cn(
                              "whitespace-nowrap text-[11px] select-none",
                              !isSelected && "text-foreground/80",
                            )}
                          >
                            {span.name}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="break-words">{span.name}</span>
                            <span className="break-words text-muted-foreground">
                              {span.serviceName}
                            </span>
                          </span>
                        </TooltipContent>
                      </Tooltip>
                      {hasChildren && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="absolute top-1"
                          style={{ left: 8 + indent }}
                          aria-label={`${collapsedSet.has(span.spanId) ? "Expand" : "Collapse"} ${span.name}`}
                          aria-expanded={!collapsedSet.has(span.spanId)}
                          onClick={() =>
                            setCollapsedSet((prev) => {
                              const next = new Set(prev);
                              if (next.has(span.spanId)) next.delete(span.spanId);
                              else next.add(span.spanId);
                              return next;
                            })
                          }
                        >
                          {collapsedSet.has(span.spanId) ? <ChevronRight /> : <ChevronDown />}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </ScrollAreaPrimitive.Content>
            </ScrollAreaPrimitive.Viewport>
            <ScrollBar orientation="horizontal" className="sticky! bottom-0 -mt-2.5 shrink-0" />
          </ScrollAreaPrimitive.Root>
          <div className="relative min-w-0 bg-muted/30 pb-3" aria-label="Span timeline">
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {Array.from({ length: tickCount + 1 }, (_, i) => (
                <span
                  key={i}
                  className="absolute inset-y-0 border-l border-border"
                  style={{
                    left: `${(i / tickCount) * 100}%`,
                    transform: i === tickCount ? "translateX(-100%)" : undefined,
                  }}
                />
              ))}
            </div>
            {visibleSpans.map(({ span }) => {
              const isSelected = selectedSpan?.spanId === span.spanId;
              const isError = span.statusCode === "Error";
              const color = isError ? ERROR_COLOR : serviceColorMap.get(span.serviceName)!;
              const start = Math.max(
                0,
                Math.min(100, (toNsOffset(span.startEpochNs, baseNs) / totalNs) * 100),
              );
              const duration = Math.max(0, Math.min(100 - start, (span.duration / totalNs) * 100));
              const durationLabel = formatDuration(span.duration);
              const durationLabelWidth = durationLabel.length * 6;
              const barWidth = Math.max(3, (timelineWidth * duration) / 100);
              const barStart = Math.min(timelineWidth - 3, (timelineWidth * start) / 100);
              const labelInside = barWidth > 50;
              const labelOnLeft = !labelInside && barStart + barWidth / 2 > timelineWidth / 2;
              const durationLeft = labelInside
                ? barStart + (barWidth - durationLabelWidth) / 2
                : labelOnLeft
                  ? barStart - durationLabelWidth - 4
                  : barStart + barWidth + 4;

              return (
                <button
                  key={span.spanId}
                  type="button"
                  aria-label={`${span.name} timeline`}
                  onMouseEnter={() => setHoveredSpanId(span.spanId)}
                  onMouseLeave={() => setHoveredSpanId(null)}
                  aria-pressed={isSelected}
                  onClick={() => onSelectSpan(span)}
                  className={cn(
                    "relative block h-8 w-full cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    hoveredSpanId === span.spanId && "bg-trace/5",
                  )}
                  style={{
                    background: isSelected
                      ? `color-mix(in oklch, ${color} 8%, transparent)`
                      : undefined,
                  }}
                >
                  <span className="absolute inset-0">
                    <span
                      className="absolute top-1/2 h-4 -translate-y-1/2 rounded-[3px]"
                      style={{
                        left: `min(${start}%, calc(100% - 3px))`,
                        width: `max(3px, ${duration}%)`,
                        filter: isSelected ? `drop-shadow(0 0 2px ${color})` : undefined,
                        background: `linear-gradient(to right, color-mix(in oklch, ${color} 90%, transparent), color-mix(in oklch, ${color} 60%, transparent))`,
                      }}
                    />
                    <span
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-center font-mono text-[10px] font-medium tabular-nums",
                        labelInside ? "text-white/90" : "text-muted-foreground",
                      )}
                      style={{ left: durationLeft, width: durationLabelWidth }}
                    >
                      {durationLabel}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
