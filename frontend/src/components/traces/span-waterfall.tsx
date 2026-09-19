import { useMemo, useState } from "react";
import { useParentSize } from "@visx/responsive";
import { ChevronDown, ChevronRight, CircleAlert, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { traceServiceColors, traceTimeline, type TimelineRange } from "./trace-timeline";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDuration, createDurationFormatter } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TraceData, SpanData } from "@/types/telemetry";

const ERROR_COLOR = "var(--destructive)";

interface Props {
  trace: TraceData;
  onSelectSpan: (span: SpanData) => void;
  selectedSpan: SpanData | null;
  range?: TimelineRange;
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

function WaterfallInner({
  trace,
  onSelectSpan,
  selectedSpan,
  width,
  range = [0, 100],
}: Props & { width: number }) {
  const flatSpans = useMemo(() => buildTree(trace.spans), [trace.spans]);
  const [hoveredSpanId, setHoveredSpanId] = useState<string | null>(null);
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const matchingIds = useMemo(() => {
    if (!search.trim() && !errorsOnly) return null;
    const byId = new Map(trace.spans.map((span) => [span.spanId, span]));
    const ids = new Set<string>();
    const query = search.trim().toLowerCase();
    for (const span of trace.spans) {
      if (errorsOnly && span.statusCode !== "Error") continue;
      if (query && !`${span.name} ${span.serviceName}`.toLowerCase().includes(query)) continue;
      let current: SpanData | undefined = span;
      while (current && !ids.has(current.spanId)) {
        ids.add(current.spanId);
        current = byId.get(current.parentSpanId);
      }
    }
    return ids;
  }, [trace.spans, search, errorsOnly]);
  const visibleSpans = useMemo(() => {
    const result: FlatSpan[] = [];
    let skipDepth: number | null = null;
    for (const f of flatSpans) {
      if (matchingIds && !matchingIds.has(f.span.spanId)) continue;
      if (skipDepth !== null && f.depth > skipDepth) continue;
      skipDepth = null;
      result.push(f);
      if (!matchingIds && collapsedSet.has(f.span.spanId)) skipDepth = f.depth;
    }
    return result;
  }, [flatSpans, collapsedSet, matchingIds]);
  const serviceColorMap = useMemo(() => traceServiceColors(trace.spans), [trace.spans]);
  const { start: baseNs, duration: totalNs } = useMemo(() => traceTimeline(trace), [trace]);
  const viewStart = (totalNs * range[0]) / 100;
  const viewEnd = (totalNs * range[1]) / 100;
  const viewDuration = Math.max(1, viewEnd - viewStart);
  const formatTick = createDurationFormatter(Math.min(viewDuration, totalNs));
  const labelWidth = Math.min(260, Math.max(150, width * 0.27));
  const serviceWidth = width < 650 ? 100 : 140;
  const timelineWidth = Math.max(0, width - labelWidth - serviceWidth - 24);
  const tickCount = Math.min(5, Math.max(1, Math.floor(timelineWidth / 100)));
  const gridTemplateColumns = `${labelWidth}px ${serviceWidth}px minmax(0, 1fr)`;
  const allCollapsed = flatSpans
    .filter((row) => row.hasChildren)
    .every((row) => collapsedSet.has(row.span.spanId));

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Trace waterfall">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2">
        <div className="relative w-48">
          <Search className="pointer-events-none absolute top-2.5 left-2 size-3.5 text-muted-foreground" />
          <Input
            aria-label="Find span"
            placeholder="Find span…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Toggle variant="outline" size="sm" pressed={errorsOnly} onPressedChange={setErrorsOnly}>
          <CircleAlert data-icon="inline-start" />
          Errors only
        </Toggle>
        <Button
          size="sm"
          variant="ghost"
          disabled={matchingIds !== null}
          onClick={() =>
            setCollapsedSet(
              allCollapsed
                ? new Set()
                : new Set(flatSpans.filter((row) => row.hasChildren).map((row) => row.span.spanId)),
            )
          }
          className="text-xs"
        >
          {allCollapsed ? "Expand all" : "Collapse all"}
        </Button>
        {matchingIds && (
          <span className="text-xs text-muted-foreground">
            {visibleSpans.length} of {flatSpans.length} spans · including parents
          </span>
        )}
      </div>
      <div
        className="grid h-9 shrink-0 border-b border-border text-[11px] text-muted-foreground"
        style={{
          gridTemplateColumns,
          background: "color-mix(in srgb, var(--muted-foreground) 10%, transparent)",
        }}
      >
        <span className="flex items-center px-2 text-xs font-medium">Operation / Span</span>
        <span className="flex items-center border-x border-border/50 px-3 text-xs font-medium">
          Service
        </span>
        <div className="relative mx-3 font-mono">
          {Array.from({ length: tickCount + 1 }, (_, i) => (
            <div
              key={i}
              className="absolute inset-y-0"
              style={{ left: `${(i / tickCount) * 100}%` }}
            >
              <span
                className="absolute bottom-0 h-2 border-l border-border"
                style={{ transform: i === tickCount ? "translateX(-100%)" : undefined }}
              />
              <span
                className="absolute top-1 px-1 font-mono whitespace-nowrap"
                style={{
                  transform: `translateX(${i === tickCount ? "-100%" : i === 0 ? "0" : "-50%"})`,
                }}
              >
                {formatTick(viewStart + (viewDuration * i) / tickCount)}
              </span>
            </div>
          ))}
          {Array.from({ length: tickCount }, (_, i) => (
            <span
              key={i}
              className="absolute bottom-0 h-1 border-l border-border"
              style={{ left: `${((i + 0.5) / tickCount) * 100}%` }}
            />
          ))}
        </div>
      </div>
      {visibleSpans.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">No matching spans.</p>
      )}
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
                      className="relative h-8 border-b border-border/30"
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
                              ? "color-mix(in oklch, var(--trace) 10%, transparent)"
                              : undefined,
                          }}
                        >
                          <span
                            className={cn(
                              "whitespace-nowrap text-xs select-none",
                              !isSelected && "text-foreground/80",
                            )}
                          >
                            {span.name}
                          </span>
                          {isError && (
                            <CircleAlert
                              aria-label="Error"
                              className="size-3.5 shrink-0 text-destructive"
                            />
                          )}
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
                          aria-label={`${!matchingIds && collapsedSet.has(span.spanId) ? "Expand" : "Collapse"} ${span.name}`}
                          aria-expanded={matchingIds !== null || !collapsedSet.has(span.spanId)}
                          disabled={matchingIds !== null}
                          onClick={() =>
                            setCollapsedSet((prev) => {
                              const next = new Set(prev);
                              if (next.has(span.spanId)) next.delete(span.spanId);
                              else next.add(span.spanId);
                              return next;
                            })
                          }
                        >
                          {!matchingIds && collapsedSet.has(span.spanId) ? (
                            <ChevronRight />
                          ) : (
                            <ChevronDown />
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </ScrollAreaPrimitive.Content>
            </ScrollAreaPrimitive.Viewport>
            <ScrollBar orientation="horizontal" className="sticky! bottom-0 -mt-2.5 shrink-0" />
          </ScrollAreaPrimitive.Root>
          <div className="min-w-0 border-x border-border/50 pb-3" aria-label="Span services">
            {visibleSpans.map(({ span }) => (
              <Tooltip key={span.spanId}>
                <TooltipTrigger
                  delay={0}
                  aria-label={`${span.name} service ${span.serviceName}`}
                  onClick={() => onSelectSpan(span)}
                  onMouseEnter={() => setHoveredSpanId(span.spanId)}
                  onMouseLeave={() => setHoveredSpanId(null)}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 border-b border-border/30 px-3 text-left text-xs transition-colors",
                    hoveredSpanId === span.spanId && "bg-trace/5",
                    selectedSpan?.spanId === span.spanId && "bg-trace/10",
                  )}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: serviceColorMap.get(span.serviceName) }}
                  />
                  <span className="truncate">{span.serviceName || "unknown"}</span>
                </TooltipTrigger>
                <TooltipContent>{span.serviceName || "unknown"}</TooltipContent>
              </Tooltip>
            ))}
          </div>
          <div className="relative min-w-0 bg-muted/20 pb-3" aria-label="Span timeline">
            <div className="pointer-events-none absolute inset-y-0 inset-x-3" aria-hidden="true">
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
              const offset = toNsOffset(span.startEpochNs, baseNs);
              const spanEnd = offset + Math.max(0, span.duration);
              const intersects = spanEnd >= viewStart && offset <= viewEnd;
              const start = Math.max(0, Math.min(100, ((offset - viewStart) / viewDuration) * 100));
              const duration = Math.max(
                0,
                Math.min(
                  100 - start,
                  ((Math.min(spanEnd, viewEnd) - Math.max(offset, viewStart)) / viewDuration) * 100,
                ),
              );
              const durationLabel = formatDuration(span.duration);
              const barWidth = Math.max(3, (timelineWidth * duration) / 100);
              const barStart = Math.min(timelineWidth - 3, (timelineWidth * start) / 100);
              const labelInside = barWidth > 50;
              const labelOnLeft = !labelInside && barStart + barWidth / 2 > timelineWidth / 2;
              const durationLeft = labelInside
                ? barStart + barWidth / 2
                : labelOnLeft
                  ? barStart - 4
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
                    "relative block h-8 w-full cursor-pointer border-b border-border/30 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    hoveredSpanId === span.spanId && "bg-trace/5",
                  )}
                  style={{
                    background: isSelected
                      ? "color-mix(in oklch, var(--trace) 10%, transparent)"
                      : undefined,
                  }}
                >
                  {intersects && (
                    <span className="absolute inset-y-0 inset-x-3 overflow-hidden">
                      <span
                        className="absolute top-1/2 h-4 -translate-y-1/2 rounded-[3px]"
                        style={{
                          left: `min(${start}%, calc(100% - 3px))`,
                          width: `max(3px, ${duration}%)`,
                          background: `linear-gradient(to right, color-mix(in oklch, ${color} 90%, transparent), color-mix(in oklch, ${color} 60%, transparent))`,
                        }}
                      />
                      <span
                        className={cn(
                          "absolute top-1/2 whitespace-nowrap text-center font-mono text-[10px] font-medium tabular-nums",
                          labelInside ? "text-white/90" : "text-muted-foreground",
                        )}
                        style={{
                          left: durationLeft,
                          transform: `translate(${labelInside ? "-50%" : labelOnLeft ? "-100%" : "0"}, -50%)`,
                        }}
                      >
                        {durationLabel}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
