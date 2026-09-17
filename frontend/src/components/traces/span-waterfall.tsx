import { useMemo, useRef, useState } from "react";
import { useParentSize } from "@visx/responsive";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  const treeViewport = useRef<HTMLDivElement>(null);
  const timelineViewport = useRef<HTMLDivElement>(null);
  const flatSpans = useMemo(() => buildTree(trace.spans), [trace.spans]);
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
  const timelineWidth = width - labelWidth - 25;
  const tickCount = timelineWidth < 180 ? 1 : timelineWidth < 360 ? 2 : 4;
  const gridTemplateColumns = `${labelWidth}px minmax(0, 1fr)`;

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Trace waterfall">
      <div
        className="grid shrink-0 border-b border-border/50 bg-muted py-3 text-xs font-medium text-trace/70"
        style={{ gridTemplateColumns }}
      >
        <span className="px-4">Operation</span>
        <div className="relative mr-3 ml-[13px] h-4 font-mono">
          {Array.from({ length: tickCount + 1 }, (_, i) => (
            <span
              key={i}
              className="absolute whitespace-nowrap"
              style={{
                left: `${(i / tickCount) * 100}%`,
                transform:
                  i === 0 ? undefined : i === tickCount ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {formatTick((totalNs * i) / tickCount)}
            </span>
          ))}
        </div>
      </div>
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns }}>
        <ScrollArea
          className="min-h-0 min-w-0"
          scrollBarOrientation="horizontal"
          viewportProps={{
            ref: treeViewport,
            "aria-label": "Span tree",
            onScroll: (event) => {
              const other = timelineViewport.current;
              if (other && other.scrollTop !== event.currentTarget.scrollTop)
                other.scrollTop = event.currentTarget.scrollTop;
            },
          }}
        >
          <div className="w-max min-w-full pb-3">
            {visibleSpans.map(({ span, depth, hasChildren }) => {
              const isSelected = selectedSpan?.spanId === span.spanId;
              const isError = span.statusCode === "Error";
              const color = isError ? ERROR_COLOR : serviceColorMap.get(span.serviceName)!;
              const indent = depth * 12;
              return (
                <div key={span.spanId} className="relative h-8 border-b border-border/30">
                  <Tooltip>
                    <TooltipTrigger
                      delay={0}
                      type="button"
                      aria-label={`${span.name}, ${span.serviceName}, ${formatDuration(span.duration)}${isError ? ", Error" : ""}`}
                      aria-pressed={isSelected}
                      onClick={() => onSelectSpan(span)}
                      className={cn(
                        "flex h-full w-full cursor-pointer items-center gap-2 pr-3 text-left outline-none transition-colors hover:bg-trace/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        isSelected && "bg-trace/10",
                      )}
                      style={{ paddingLeft: 40 + indent }}
                    >
                      <span
                        className="h-4 w-1 shrink-0 rounded-full"
                        style={{ background: color }}
                      />
                      <span className="whitespace-nowrap text-sm">{span.name}</span>
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
                      style={{ left: 12 + indent }}
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
          </div>
        </ScrollArea>
        <ScrollArea
          className="min-h-0 min-w-0 border-l border-border/50 bg-muted/30"
          viewportProps={{
            ref: timelineViewport,
            "aria-label": "Span timeline",
            onScroll: (event) => {
              const other = treeViewport.current;
              if (other && other.scrollTop !== event.currentTarget.scrollTop)
                other.scrollTop = event.currentTarget.scrollTop;
            },
          }}
        >
          <div className="pb-3">
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
              const durationLabelWidth = durationLabel.length * 7.25;
              const barWidth = Math.max(3, (timelineWidth * duration) / 100);
              const barStart = Math.min(timelineWidth - 3, (timelineWidth * start) / 100);
              const labelInside = barWidth >= durationLabelWidth + 12;
              const labelOnLeft = barStart + barWidth + durationLabelWidth + 6 > timelineWidth;
              const durationLeft = labelInside
                ? barStart + (barWidth - durationLabelWidth) / 2
                : Math.max(
                    0,
                    Math.min(
                      timelineWidth - durationLabelWidth,
                      labelOnLeft ? barStart - durationLabelWidth - 6 : barStart + barWidth + 6,
                    ),
                  );

              return (
                <button
                  key={span.spanId}
                  type="button"
                  aria-label={`${span.name} timeline`}
                  aria-pressed={isSelected}
                  onClick={() => onSelectSpan(span)}
                  className={cn(
                    "relative block h-8 w-full cursor-pointer border-b border-border/30 outline-none transition-colors hover:bg-trace/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    isSelected && "bg-trace/10",
                  )}
                >
                  <span className="absolute inset-x-3 inset-y-0">
                    {Array.from({ length: tickCount + 1 }, (_, i) => (
                      <span
                        key={i}
                        className="absolute inset-y-0 border-l border-border/50"
                        style={{
                          left: `${(i / tickCount) * 100}%`,
                          transform: i === tickCount ? "translateX(-100%)" : undefined,
                        }}
                      />
                    ))}
                    <span
                      className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm"
                      style={{
                        left: `min(${start}%, calc(100% - 3px))`,
                        width: `max(3px, ${duration}%)`,
                        background: `linear-gradient(to right, color-mix(in oklch, ${color} 90%, transparent), color-mix(in oklch, ${color} 60%, transparent))`,
                      }}
                    />
                    <span
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-center font-mono text-xs tabular-nums",
                        labelInside ? "text-white" : "text-muted-foreground",
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
        </ScrollArea>
      </div>
    </div>
  );
}
