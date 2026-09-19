import type { SpanData, TraceData } from "@/types/telemetry";

const SERVICE_COLORS = [
  "oklch(0.65 0.14 195)",
  "oklch(0.67 0.14 80)",
  "oklch(0.63 0.14 300)",
  "oklch(0.63 0.17 155)",
  "oklch(0.60 0.18 15)",
  "oklch(0.65 0.12 230)",
];
export type TimelineRange = [number, number];

export function traceTimeline(trace: TraceData) {
  let start = trace.startEpochNs;
  let duration = trace.duration;
  if (duration <= 0 && trace.spans.length) {
    start = trace.spans.reduce(
      (min, span) => (span.startEpochNs < min ? span.startEpochNs : min),
      trace.spans[0].startEpochNs,
    );
    const end = trace.spans.reduce(
      (max, span) => (span.endEpochNs > max ? span.endEpochNs : max),
      start,
    );
    duration = Number(end - start);
  }
  duration = Math.max(1, duration);
  return { start, duration };
}

export function traceServiceColors(spans: SpanData[]): Map<string, string> {
  const services = [...new Set(spans.map((span) => span.serviceName))];
  return new Map(
    services.map((service, index) => [service, SERVICE_COLORS[index % SERVICE_COLORS.length]]),
  );
}
