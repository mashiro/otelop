import { describe, expect, it, vi } from "vite-plus/test";
import { Temporal } from "temporal-polyfill";
import {
  eventWindowAround,
  eventWindowBounds,
  eventWindowDomain,
  eventWindowRange,
  eventWindowWidthMs,
  filterPointsInEventWindow,
  shiftEventWindow,
} from "./event-time-window";

describe("event time window", () => {
  it("resolves a live range against the current instant", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T00:00:00Z"));

    expect(eventWindowBounds({ mode: "live", range: "1h" })).toEqual({
      from: "2026-07-11T23:00:00Z",
      to: "2026-07-12T00:00:00Z",
    });

    vi.useRealTimers();
  });

  it("moves by exactly one window width and becomes fixed", () => {
    const window = {
      mode: "fixed" as const,
      from: "2026-07-12T01:00:00Z",
      to: "2026-07-12T02:00:00Z",
    };
    expect(shiftEventWindow(window, -1)).toEqual({
      mode: "fixed",
      from: "2026-07-12T00:00:00Z",
      to: "2026-07-12T01:00:00Z",
    });
    expect(eventWindowWidthMs(window)).toBe(3_600_000);
    expect(eventWindowRange(window)).toBe("1h");
  });

  it("returns no preset range for a custom fixed window", () => {
    expect(
      eventWindowRange({
        mode: "fixed",
        from: "2026-07-12T01:00:00Z",
        to: "2026-07-12T01:42:00Z",
      }),
    ).toBeNull();
  });

  it("centers a fixed window on a selected log timestamp", () => {
    const centered = eventWindowAround("2026-07-12T03:00:00Z", {
      mode: "live",
      range: "1h",
    });
    expect(centered).toEqual({
      mode: "fixed",
      from: "2026-07-12T02:30:00Z",
      to: "2026-07-12T03:30:00Z",
    });
    expect(centered.mode).toBe("fixed");
    if (centered.mode !== "fixed") throw new Error("expected a fixed window");
    expect(
      Temporal.Instant.compare(
        Temporal.Instant.from(centered.from),
        Temporal.Instant.from(centered.to),
      ),
    ).toBeLessThan(0);
  });

  it("does not move a live window into the future for a recent log", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T03:10:00Z"));

    expect(eventWindowAround("2026-07-12T03:00:00Z", { mode: "live", range: "1h" })).toEqual({
      mode: "fixed",
      from: "2026-07-12T02:10:00Z",
      to: "2026-07-12T03:10:00Z",
    });

    vi.useRealTimers();
  });

  it("still centers an older log within a live window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T05:00:00Z"));

    expect(eventWindowAround("2026-07-12T03:00:00Z", { mode: "live", range: "1h" })).toEqual({
      mode: "fixed",
      from: "2026-07-12T02:30:00Z",
      to: "2026-07-12T03:30:00Z",
    });

    vi.useRealTimers();
  });

  it("uses fixed bounds for filtering and chart domains", () => {
    const window = {
      mode: "fixed" as const,
      from: "2026-07-12T01:00:00Z",
      to: "2026-07-12T02:00:00Z",
    };
    const points = [
      { timestamp: "2026-07-12T00:59:59Z" },
      { timestamp: "2026-07-12T01:30:00Z" },
      { timestamp: "2026-07-12T02:00:01Z" },
    ];

    expect(filterPointsInEventWindow(points, window, (point) => point.timestamp)).toEqual([
      points[1],
    ]);
    expect(eventWindowDomain([], window)).toEqual([
      new Date("2026-07-12T01:00:00Z"),
      new Date("2026-07-12T02:00:00Z"),
    ]);
  });
});
