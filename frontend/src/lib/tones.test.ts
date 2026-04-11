import { describe, it, expect } from "vitest";
import { severityTone, traceStatusTone } from "./tones";

describe("traceStatusTone", () => {
  it("maps Ok to success", () => {
    expect(traceStatusTone("Ok")).toBe("success");
  });
  it("maps Error to destructive", () => {
    expect(traceStatusTone("Error")).toBe("destructive");
  });
  it("maps unknown/unset values to muted", () => {
    expect(traceStatusTone("Unset")).toBe("muted");
    expect(traceStatusTone("")).toBe("muted");
    expect(traceStatusTone("weird")).toBe("muted");
  });
});

describe("severityTone", () => {
  it("maps INFO to primary", () => {
    expect(severityTone("INFO")).toBe("primary");
  });
  it("maps WARN to warning", () => {
    expect(severityTone("WARN")).toBe("warning");
  });
  it("maps ERROR and FATAL to destructive", () => {
    expect(severityTone("ERROR")).toBe("destructive");
    expect(severityTone("FATAL")).toBe("destructive");
  });
  it("maps TRACE/DEBUG and unknown values to muted", () => {
    expect(severityTone("TRACE")).toBe("muted");
    expect(severityTone("DEBUG")).toBe("muted");
    expect(severityTone("")).toBe("muted");
    expect(severityTone(undefined)).toBe("muted");
    expect(severityTone("WHAT")).toBe("muted");
  });
});
