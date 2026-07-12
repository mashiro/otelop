import { Temporal } from "temporal-polyfill";
import { DEFAULT_CHART_TIME_RANGE, rangeToMs, type ChartTimeRange } from "@/lib/chart-time-range";

export type EventTimeWindow =
  | { mode: "live"; range: ChartTimeRange }
  | { mode: "fixed"; from: string; to: string };

export const DEFAULT_EVENT_TIME_WINDOW: EventTimeWindow = {
  mode: "live",
  range: DEFAULT_CHART_TIME_RANGE,
};

export function eventWindowBounds(window: EventTimeWindow): {
  from: string | undefined;
  to: string;
} {
  if (window.mode === "fixed") return { from: window.from, to: window.to };
  const to = Temporal.Now.instant();
  const rangeMs = rangeToMs(window.range);
  return {
    from: rangeMs === null ? undefined : to.subtract({ milliseconds: rangeMs }).toString(),
    to: to.toString(),
  };
}

export function eventWindowKey(window: EventTimeWindow): string {
  return window.mode === "live" ? `live:${window.range}` : `fixed:${window.from}:${window.to}`;
}

export function eventWindowWidthMs(window: EventTimeWindow): number {
  if (window.mode === "live") {
    return rangeToMs(window.range) ?? rangeToMs(DEFAULT_CHART_TIME_RANGE)!;
  }
  return Number(
    Temporal.Instant.from(window.to)
      .since(Temporal.Instant.from(window.from))
      .total("milliseconds"),
  );
}

export function shiftEventWindow(window: EventTimeWindow, direction: -1 | 1): EventTimeWindow {
  const { from, to } = eventWindowBounds(window);
  const widthMs = eventWindowWidthMs(window);
  const fixedTo = Temporal.Instant.from(to);
  const fixedFrom = from
    ? Temporal.Instant.from(from)
    : fixedTo.subtract({ milliseconds: widthMs });
  return {
    mode: "fixed",
    from: fixedFrom.add({ milliseconds: direction * widthMs }).toString(),
    to: fixedTo.add({ milliseconds: direction * widthMs }).toString(),
  };
}

export function eventWindowAround(timestamp: string, source: EventTimeWindow): EventTimeWindow {
  const widthMs = eventWindowWidthMs(source);
  const center = Temporal.Instant.from(timestamp);
  const beforeMs = Math.floor(widthMs / 2);
  return {
    mode: "fixed",
    from: center.subtract({ milliseconds: beforeMs }).toString(),
    to: center.add({ milliseconds: widthMs - beforeMs }).toString(),
  };
}

export function eventWindowEquals(a: EventTimeWindow, b: EventTimeWindow): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "live" && b.mode === "live") return a.range === b.range;
  return a.mode === "fixed" && b.mode === "fixed" && a.from === b.from && a.to === b.to;
}
