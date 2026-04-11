import type { SpanData, TraceData, LogData, MetricData } from "@/types/telemetry";

export function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  return {
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
  };
}

export function makeTrace(overrides: Partial<TraceData> = {}): TraceData {
  return {
    traceId: "t1",
    spans: [makeSpan()],
    spanCount: 1,
    serviceName: "frontend",
    startTime: "2024-01-01T00:00:00Z",
    duration: 1_000_000,
    ...overrides,
  };
}

export function makeLog(overrides: Partial<LogData> = {}): LogData {
  return {
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
  };
}

export function makeMetric(overrides: Partial<MetricData> = {}): MetricData {
  return {
    name: "http.requests",
    type: "Sum",
    unit: "",
    description: "",
    serviceName: "frontend",
    resource: {},
    dataPoints: [],
    receivedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}
