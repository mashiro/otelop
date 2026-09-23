import { describe, it, expect } from "vite-plus/test";
import { formatElapsedMs, formatDateTime, formatRelativeTime } from "./format";

describe("formatElapsedMs", () => {
  it.each([
    [850, "850ms"],
    [0, "0ms"],
    [999, "999ms"],
    [1_000, "1s"],
    [42_000, "42s"],
    [59_000, "59s"],
    [64_000, "1m 4s"],
    [60_000, "1m"],
    [3_600_000, "1h"],
    [3_600_000 + 5 * 60_000, "1h 5m"],
    [23 * 3_600_000, "23h"],
    [86_400_000, "1d"],
    [2 * 86_400_000 + 3 * 3_600_000, "2d 3h"],
  ])("formats %dms as %s", (ms, want) => {
    expect(formatElapsedMs(ms)).toBe(want);
  });
});

describe("formatDateTime", () => {
  it("formats an ISO timestamp as YYYY-MM-DD HH:MM:SS with no milliseconds", () => {
    const iso = new Date(2026, 8, 23, 13, 44, 8, 123).toISOString();
    expect(formatDateTime(iso)).toBe("2026-09-23 13:44:08");
  });

  it("zero-pads single-digit components", () => {
    const iso = new Date(2026, 0, 5, 3, 7, 9, 0).toISOString();
    expect(formatDateTime(iso)).toBe("2026-01-05 03:07:09");
  });
});

describe("formatRelativeTime", () => {
  it("formats a past timestamp as '... ago'", () => {
    const past = new Date(Date.now() - 65_000).toISOString();
    expect(formatRelativeTime(past)).toBe("1m ago");
  });

  it("formats a future timestamp as 'in ...'", () => {
    const future = new Date(Date.now() + 65_000).toISOString();
    expect(formatRelativeTime(future)).toBe("in 1m");
  });

  it("treats a timestamp within 1s of now as 'now'", () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe("now");
  });
});
