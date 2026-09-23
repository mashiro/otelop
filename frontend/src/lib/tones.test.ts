import { describe, it, expect } from "vite-plus/test";
import { severityTone, traceStatusTone } from "./tones";

describe("traceStatusTone", () => {
  it("maps Ok to success", () => {
    expect(traceStatusTone("Ok")).toBe("success");
  });
  it("maps Error to destructive", () => {
    expect(traceStatusTone("Error")).toBe("destructive");
  });
  it("maps Unset to muted", () => {
    expect(traceStatusTone("Unset")).toBe("muted");
  });
});

describe("severityTone", () => {
  it("maps INFO to info", () => {
    expect(severityTone("INFO")).toBe("info");
  });
  it("maps WARN to warning", () => {
    expect(severityTone("WARN")).toBe("warning");
  });
  it("distinguishes ERROR from FATAL", () => {
    expect(severityTone("ERROR")).toBe("destructive");
    expect(severityTone("FATAL")).toBe("fatal");
  });
  it("matches severity text case-insensitively", () => {
    expect(severityTone("info")).toBe("info");
    expect(severityTone("Warn")).toBe("warning");
    expect(severityTone("error")).toBe("destructive");
    expect(severityTone("fatal")).toBe("fatal");
  });
  it("maps WARNING and CRITICAL aliases", () => {
    expect(severityTone("WARNING")).toBe("warning");
    expect(severityTone("critical")).toBe("fatal");
  });
  it("keeps TRACE and unknown values muted and DEBUG slate", () => {
    expect(severityTone("TRACE")).toBe("muted");
    expect(severityTone("DEBUG")).toBe("debug");
    expect(severityTone("")).toBe("muted");
    expect(severityTone(undefined)).toBe("muted");
    expect(severityTone("WHAT")).toBe("muted");
  });
});

describe("severity number fallback", () => {
  it.each([
    [1, "muted"],
    [4, "muted"],
    [5, "debug"],
    [8, "debug"],
    [9, "info"],
    [12, "info"],
    [13, "warning"],
    [16, "warning"],
    [17, "destructive"],
    [20, "destructive"],
    [21, "fatal"],
    [24, "fatal"],
  ] as const)("maps %i to %s when text is missing or custom", (number, tone) => {
    expect(severityTone("", number)).toBe(tone);
    expect(severityTone("custom", number)).toBe(tone);
  });
  it.each([0, -1, 25, 17.5, NaN, Infinity])("rejects invalid severity number %s", (number) => {
    expect(severityTone(undefined, number)).toBe("muted");
  });
  it.each([
    ["TRACE", "muted"],
    ["DEBUG", "debug"],
    ["INFO", "info"],
    ["WARN", "warning"],
    ["ERROR", "destructive"],
    ["FATAL", "fatal"],
  ] as const)("normalizes %s severity family", (label, tone) => {
    for (const suffix of ["", "2", "3", "4"])
      expect(severityTone(` ${label.toLowerCase()}${suffix} `)).toBe(tone);
  });
  it("preserves recognized severity text before numeric fallback", () => {
    expect(severityTone("INFO", 17)).toBe("info");
    expect(severityTone("ERROR5")).toBe("muted");
  });
});
