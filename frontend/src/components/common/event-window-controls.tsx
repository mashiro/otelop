import { useAtom } from "jotai";
import { ChevronLeft, ChevronRight, Radio } from "lucide-react";
import { Temporal } from "temporal-polyfill";
import { Button } from "@/components/ui/button";
import { TimeRangeSelect } from "@/components/common/time-range-select";
import { eventTimeWindowAtom } from "@/stores/navigation";
import {
  DEFAULT_EVENT_TIME_WINDOW,
  eventWindowRange,
  shiftEventWindow,
} from "@/lib/event-time-window";

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
  const range = eventWindowRange(window);
  const canMove = range !== "all";

  return (
    <div className="flex items-center gap-1">
      {window.mode === "fixed" && (
        <span className="px-1 font-mono text-[11px] text-muted-foreground">
          {formatInstant(window.from)} – {formatInstant(window.to)}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setWindow(shiftEventWindow(window, -1))}
        disabled={!canMove}
        title="Previous window"
      >
        <ChevronLeft />
      </Button>
      <TimeRangeSelect
        range={range}
        onRangeChange={(nextRange) => setWindow({ mode: "live", range: nextRange })}
        tone={tone}
      />
      {window.mode === "fixed" && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setWindow(shiftEventWindow(window, 1))}
          disabled={!canMove}
          title="Next window"
        >
          <ChevronRight />
        </Button>
      )}
      {window.mode === "live" && <span aria-hidden className="size-7" />}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setWindow(range ? { mode: "live", range } : DEFAULT_EVENT_TIME_WINDOW)}
        disabled={window.mode === "live"}
      >
        <Radio className="size-3 text-emerald-500" /> Live
      </Button>
    </div>
  );
}
