import { HelpTooltip } from "@/components/ui/help-tooltip";
import { ChevronLeft, ChevronRight, Radio } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import { Button } from "@/components/ui/button";
import { TimeRangeSelect } from "@/components/common/time-range-select";
import { useTimeWindow } from "@/hooks/use-signal-route";
import {
  DEFAULT_EVENT_TIME_WINDOW,
  eventWindowRange,
  shiftEventWindow,
  type EventTimeWindow,
} from "@/lib/event-time-window";
import { cn } from "@/lib/utils";

function formatInstant(value: string): string {
  return Temporal.Instant.from(value)
    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
    .toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
}

export function EventWindowControls({
  tone,
  allRetained = false,
}: {
  tone: "trace" | "log";
  allRetained?: boolean;
}) {
  const [window, setWindow] = useTimeWindow();

  if (allRetained) {
    return (
      <span className="px-2 text-xs font-medium text-muted-foreground">All retained data</span>
    );
  }

  return <TimeWindowControls window={window} onWindowChange={setWindow} tone={tone} />;
}

export function TimeWindowControls({
  window,
  onWindowChange,
  tone,
  size = "sm",
}: {
  window: EventTimeWindow;
  onWindowChange: (window: EventTimeWindow) => void;
  tone: "trace" | "metric" | "log";
  size?: "sm" | "md";
}) {
  const range = eventWindowRange(window);
  const canMove = range !== "all";
  const isLive = window.mode === "live";

  return (
    <div className="flex items-center gap-1">
      {window.mode === "fixed" && (
        <span className="px-1 font-mono text-[11px] text-muted-foreground">
          {formatInstant(window.from)} – {formatInstant(window.to)}
        </span>
      )}
      <HelpTooltip content="Previous window">
        <Button
          aria-label="Previous window"
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onWindowChange(shiftEventWindow(window, -1))}
          disabled={!canMove}
        >
          <ChevronLeft />
        </Button>
      </HelpTooltip>
      <TimeRangeSelect
        range={range}
        onRangeChange={(nextRange) => onWindowChange({ mode: "live", range: nextRange })}
        tone={tone}
        size={size}
      />
      {window.mode === "fixed" && (
        <HelpTooltip content="Next window">
          <Button
            aria-label="Next window"
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onWindowChange(shiftEventWindow(window, 1))}
            disabled={!canMove}
          >
            <ChevronRight />
          </Button>
        </HelpTooltip>
      )}
      {window.mode === "live" && <span aria-hidden className="size-7" />}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onWindowChange(range ? { mode: "live", range } : DEFAULT_EVENT_TIME_WINDOW)}
        disabled={isLive}
        className={cn(
          "disabled:opacity-100",
          isLive
            ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
            : "text-muted-foreground",
        )}
      >
        <Radio
          className={cn(
            "size-3",
            isLive
              ? "animate-pulse-glow text-emerald-500 drop-shadow-[0_0_4px_oklch(0.72_0.17_155/0.7)]"
              : "text-muted-foreground",
          )}
        />
        Live
      </Button>
    </div>
  );
}
