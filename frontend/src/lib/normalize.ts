import { Temporal } from "temporal-polyfill";
import type {
  SpanDataWire,
  SpanData,
  TraceDataWire,
  TraceData,
  DataPointWire,
  DataPoint,
  MetricDataWire,
  MetricData,
  LogDataWire,
  LogData,
} from "@/types/telemetry";

// The single call site for parsing an OTel ISO-8601 timestamp string into
// epoch nanoseconds. Temporal.Instant.from (never Date.parse, which truncates
// to millisecond precision — see CLAUDE.md) preserves the full ns precision
// OTel emits. Every normalize* function below routes through this, and every
// other module reads the resulting epoch field off a view model instead of
// re-parsing the same ISO string on every sort/filter/chart recompute — the
// whole point of this module (see stores/telemetry.ts's sort and
// stores/filters.ts's range filter, previously ~4-10ms per recompute over the
// full buffer).
export function parseEpochNs(iso: string): bigint {
  return Temporal.Instant.from(iso).epochNanoseconds;
}

// normalizeSpan is the only place that converts a wire SpanData (GraphQL
// fragment or WS payload) into the view model spans/waterfall code (and
// stores/telemetry.ts's mergeSpans/mergeTrace) actually consume.
export function normalizeSpan(span: SpanDataWire): SpanData {
  return {
    ...span,
    startEpochNs: parseEpochNs(span.startTime),
    endEpochNs: parseEpochNs(span.endTime),
  };
}

// normalizeTrace is the only entry point that should produce a TraceData —
// every ingest path (WS deliveries via hooks/use-websocket.ts, the
// traces-list/trace-by-id GraphQL fetches, test/factories.ts's makeTrace)
// must route through this so a trace can never enter the store missing
// startEpochNs.
export function normalizeTrace(trace: TraceDataWire): TraceData {
  return {
    ...trace,
    spans: trace.spans.map(normalizeSpan),
    startEpochNs: parseEpochNs(trace.startTime),
  };
}

export function normalizeDataPoint(point: DataPointWire): DataPoint {
  return { ...point, epochNs: parseEpochNs(point.timestamp) };
}

export function normalizeMetric(metric: MetricDataWire): MetricData {
  return { ...metric, dataPoints: metric.dataPoints.map(normalizeDataPoint) };
}

export function normalizeLog(log: LogDataWire): LogData {
  return { ...log, epochNs: parseEpochNs(log.timestamp) };
}
