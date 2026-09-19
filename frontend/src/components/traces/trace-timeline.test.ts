import { describe, expect, it } from "vite-plus/test";
import { makeSpan, makeTrace } from "@/test/factories";
import { traceTimeline } from "./trace-timeline";

describe("traceTimeline", () => {
  it("ends the visible range at the exact trace endpoint", () => {
    expect(traceTimeline(makeTrace({ duration: 842e6 })).duration).toBe(842e6);
    expect(traceTimeline(makeTrace({ duration: 1e9 })).duration).toBe(1e9);
  });
  it("preserves nanosecond precision when a trace has no summary duration", () => {
    const span = makeSpan({
      startTime: "2024-01-01T00:00:00.000000100Z",
      endTime: "2024-01-01T00:00:00.000000400Z",
      duration: 300,
    });
    expect(traceTimeline(makeTrace({ duration: 0, spans: [span] }))).toMatchObject({
      start: span.startEpochNs,
      duration: 300,
    });
  });
  it("keeps an empty trace finite", () => {
    const timeline = traceTimeline(makeTrace({ duration: 0, spans: [] }));
    expect(timeline.duration).toBeGreaterThan(0);
    expect(Number.isFinite(timeline.duration)).toBe(true);
  });
});
