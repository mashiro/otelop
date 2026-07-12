import { useAtom } from "jotai";
import { ChevronLeft, ChevronRight, Radio } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import { Button } from "@/components/ui/button";
import { TimeRangeTabs } from "@/components/common/time-range-tabs";
import { eventTimeWindowAtom } from "@/stores/navigation";
import { DEFAULT_EVENT_TIME_WINDOW, shiftEventWindow } from "@/lib/event-time-window";

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

export function EventWindowControls({ tone }: { tone: "trace" | "log" }) {
  const [window, setWindow] = useAtom(eventTimeWindowAtom);

  if (window.mode === "live") {
    return (
      <div className="flex items-center gap-2">
        <TimeRangeTabs
          range={window.range}
          onRangeChange={(range) => setWindow({ mode: "live", range })}
          tone={tone}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setWindow(shiftEventWindow(window, -1))}
          title="Move one window into the past"
        >
          <ChevronLeft />
        </Button>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Radio className="size-3 text-emerald-500" /> Live
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setWindow(shiftEventWindow(window, -1))}
        title="Previous window"
      >
        <ChevronLeft />
      </Button>
      <span className="min-w-64 text-center font-mono text-[11px] text-muted-foreground">
        {formatInstant(window.from)} – {formatInstant(window.to)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setWindow(shiftEventWindow(window, 1))}
        title="Next window"
      >
        <ChevronRight />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setWindow(DEFAULT_EVENT_TIME_WINDOW)}
      >
        <Radio className="size-3 text-emerald-500" /> Live
      </Button>
    </div>
  );
}
