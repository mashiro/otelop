import { useMemo, useState } from "react";
import { Slider } from "@base-ui/react/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDuration } from "@/lib/format";
import type { TraceData } from "@/types/telemetry";
import { traceServiceColors, traceTimeline, type TimelineRange } from "./trace-timeline";
import { useTraceRangeSelection } from "./use-trace-range-selection";

export function TraceOverview({
  trace,
  range,
  onRangeChange,
}: {
  trace: TraceData;
  range: TimelineRange;
  onRangeChange: (range: TimelineRange) => void;
}) {
  const selectionHandlers = useTraceRangeSelection(onRangeChange);
  const { start, duration } = useMemo(() => traceTimeline(trace), [trace]);
  const serviceColors = useMemo(() => traceServiceColors(trace.spans), [trace.spans]);
  return (
    <section
      aria-label="Trace overview"
      className="flex shrink-0 items-center gap-4 border-b border-border/50 px-4 py-2"
    >
      <Slider.Root
        {...selectionHandlers}
        onDoubleClick={() => onRangeChange([0, 100])}
        className="min-w-0 flex-1"
        value={range}
        onValueChange={onRangeChange}
        min={0}
        max={100}
        step={0.1}
        minStepsBetweenValues={1}
        thumbCollisionBehavior="none"
        aria-label="Visible time range"
      >
        <Slider.Control className="relative h-10 cursor-crosshair touch-none select-none">
          <Slider.Track className="relative h-full overflow-hidden rounded-md border border-border bg-muted/30">
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {trace.spans.map((span, index) => (
                <span
                  key={span.spanId}
                  className="absolute rounded-sm"
                  style={{
                    left: `${Math.max(0, (Number(span.startEpochNs - start) / duration) * 100)}%`,
                    width: `max(2px, ${(Math.max(0, span.duration) / duration) * 100}%)`,
                    top: 5 + (index * 28) / trace.spans.length,
                    height: Math.min(4, 28 / trace.spans.length),
                    background:
                      span.statusCode === "Error"
                        ? "var(--destructive)"
                        : serviceColors.get(span.serviceName),
                  }}
                />
              ))}
            </div>
            <Slider.Indicator className="absolute h-full border-x border-trace bg-trace/5" />
          </Slider.Track>
          {[0, 1].map((index) => (
            <OverviewThumb key={index} index={index} duration={duration} />
          ))}
        </Slider.Control>
      </Slider.Root>
    </section>
  );
}

function OverviewThumb({ index, duration }: { index: number; duration: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Slider.Thumb
      data-overview-thumb=""
      index={index}
      aria-label={index === 0 ? "Range start" : "Range end"}
      getAriaValueText={(_, value) => formatDuration((duration * value) / 100)}
      className="top-1/2 flex h-10 w-2 -translate-y-1/2 items-center justify-center rounded-sm border border-background bg-trace outline-none focus-visible:ring-2 focus-visible:ring-ring"
      render={(props, state) => (
        <Tooltip
          open={open || (state.dragging && state.activeThumbIndex === index)}
          onOpenChange={setOpen}
        >
          <TooltipTrigger delay={0} closeOnClick={false} render={<div {...props} />} />
          <TooltipContent className="font-mono whitespace-nowrap">
            {formatDuration((duration * state.values[index]) / 100)}
          </TooltipContent>
        </Tooltip>
      )}
    >
      <span className="h-2 w-0.5 rounded bg-background" />
    </Slider.Thumb>
  );
}
