import { Temporal } from "temporal-polyfill";
import {
  CHART_TIME_RANGES,
  DEFAULT_CHART_TIME_RANGE,
  filterDataPointsInRange,
  rangeToMs,
  timeRangeDomain,
  type ChartTimeRange,
} from "@/lib/chart-time-range";

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

export function eventWindowRange(window: EventTimeWindow): ChartTimeRange | null {
  if (window.mode === "live") return window.range;
  const widthMs = eventWindowWidthMs(window);
  return (
    CHART_TIME_RANGES.find(({ value }) => {
      const rangeMs = rangeToMs(value);
      return rangeMs !== null && rangeMs === widthMs;
    })?.value ?? null
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
  const centeredTo = center.add({ milliseconds: widthMs - beforeMs });
  if (source.mode === "live") {
    const now = Temporal.Now.instant();
    if (
      Temporal.Instant.compare(center, now) <= 0 &&
      Temporal.Instant.compare(centeredTo, now) > 0
    ) {
      return {
        mode: "fixed",
        from: now.subtract({ milliseconds: widthMs }).toString(),
        to: now.toString(),
      };
    }
  }
  return {
    mode: "fixed",
    from: center.subtract({ milliseconds: beforeMs }).toString(),
    to: centeredTo.toString(),
  };
}

export function eventWindowEquals(a: EventTimeWindow, b: EventTimeWindow): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "live" && b.mode === "live") return a.range === b.range;
  return a.mode === "fixed" && b.mode === "fixed" && a.from === b.from && a.to === b.to;
}

export function filterPointsInEventWindow<T>(
  points: T[],
  window: EventTimeWindow,
  getTimestamp: (point: T) => string,
): T[] {
  if (window.mode === "live") return filterDataPointsInRange(points, window.range, getTimestamp);
  const from = Temporal.Instant.from(window.from);
  const to = Temporal.Instant.from(window.to);
  return points.filter((point) => {
    const instant = Temporal.Instant.from(getTimestamp(point));
    return (
      Temporal.Instant.compare(instant, from) >= 0 && Temporal.Instant.compare(instant, to) <= 0
    );
  });
}

export function eventWindowDomain(
  points: { time: Date }[],
  window: EventTimeWindow,
): [Date, Date] | null {
  if (window.mode === "live") return timeRangeDomain(points, window.range);
  return [new Date(window.from), new Date(window.to)];
}
