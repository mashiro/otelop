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
