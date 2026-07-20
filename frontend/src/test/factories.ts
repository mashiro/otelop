import type { SpanData, TraceData, LogData, MetricData, DataPoint } from "@/types/telemetry";
import type { AggregatePointData, AggregateSeriesData } from "@/hooks/use-metric-aggregate-series";
import {
  normalizeSpan,
  normalizeTrace,
  normalizeLog,
  normalizeDataPoint,
  normalizeMetric,
} from "@/lib/normalize";

// A convenient row count for list-rendering tests to set
// stores/telemetry.ts's renderWindowMaxAtom to and build fixture lists
// against — not tied to the backend's configurable default value, just a
// round number comfortably larger than any test's assertions need.
export const TEST_RENDER_WINDOW_MAX = 500;

// Every factory below builds its wire-shaped defaults, merges in overrides,
// then runs the result through lib/normalize.ts's normalize* function — the
// same function every real ingest entry point uses — so a test can never
// construct a record with a stale/missing epoch field, and overriding
// startTime/timestamp always re-derives the matching epoch automatically.
export function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  return normalizeSpan({
    traceId: "t1",
    spanId: "s1",
    parentSpanId: "",
    name: "GET /api",
    kind: "Server",
    serviceName: "frontend",
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-01T00:00:01Z",
    duration: 1_000_000,
    statusCode: "Ok",
    statusMessage: "",
    attributes: {},
    events: [],
    resource: {},
    ...overrides,
  });
}

// Converts a makeSpan()-shaped SpanData back into the GraphQL SpanFields
// fragment shape (durationMs instead of duration) a mocked gqlClient.request
// response needs — the inverse of lib/span-mapping.ts's toSpan.
export function toQuerySpan(span: SpanData) {
  const { duration, startEpochNs: _startEpochNs, endEpochNs: _endEpochNs, ...rest } = span;
  return { ...rest, durationMs: duration / 1_000_000 };
}

export function makeTrace(overrides: Partial<TraceData> = {}): TraceData {
  return normalizeTrace({
    traceId: "t1",
    spans: [makeSpan()],
    spanCount: 1,
    serviceName: "frontend",
    startTime: "2024-01-01T00:00:00Z",
    duration: 1_000_000,
    ...overrides,
  });
}

export function makeLog(overrides: Partial<LogData> = {}): LogData {
  return normalizeLog({
    id: "log-1",
    timestamp: "2024-01-01T00:00:00Z",
    observedTimestamp: "2024-01-01T00:00:00Z",
    severityNumber: 9,
    severityText: "INFO",
    body: "request handled",
    traceId: "",
    spanId: "",
    serviceName: "frontend",
    attributes: {},
    resource: {},
    ...overrides,
  });
}

export function makeDataPoint(overrides: Partial<DataPoint> = {}): DataPoint {
  return normalizeDataPoint({
    id: "dp-1",
    timestamp: "2024-01-01T00:00:00Z",
    value: 0,
    attributes: {},
    ...overrides,
  });
}

export function makeMetric(overrides: Partial<MetricData> = {}): MetricData {
  return normalizeMetric({
    name: "http.requests",
    type: "Sum",
    unit: "",
    description: "",
    serviceName: "frontend",
    resource: {},
    dataPoints: [],
    pointCount: 0,
    latestValue: null,
    receivedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  });
}

export function makeAggregatePoint(
  overrides: Partial<AggregatePointData> = {},
): AggregatePointData {
  return {
    timestamp: "2024-01-01T00:00:00Z",
    value: 0,
    count: null,
    sum: null,
    min: null,
    max: null,
    ...overrides,
  };
}

export function makeAggregateSeries(
  overrides: Partial<AggregateSeriesData> = {},
): AggregateSeriesData {
  return {
    groupValues: ["a"],
    points: [makeAggregatePoint()],
    ...overrides,
  };
}
