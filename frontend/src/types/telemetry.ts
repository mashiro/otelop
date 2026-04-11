export interface SpanEvent {
  name: string;
  timestamp: string;
  attributes: Record<string, unknown>;
}

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  kind: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  duration: number;
  statusCode: string;
  statusMessage: string;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  resource: Record<string, unknown>;
}

export interface TraceData {
  traceId: string;
  rootSpan?: SpanData;
  spans: SpanData[];
  serviceName: string;
  spanCount: number;
  startTime: string;
  duration: number;
}

export interface DataPoint {
  timestamp: string;
  // For Gauge: instantaneous value. For Sum: per-window delta. For
  // Histogram/Summary/ExponentialHistogram: per-window mean (sum/count), so
  // the metric's declared unit applies directly.
  value: number;
  // Distribution-only fields (Histogram / Summary / ExponentialHistogram).
  // Counts and sums are per-window deltas; min/max are per-window extrema
  // reported by the SDK and cannot be delta'd. Null when the metric type
  // doesn't carry the field — use `!= null` checks.
  count?: number | null;
  sum?: number | null;
  min?: number | null;
  max?: number | null;
  attributes: Record<string, unknown>;
}

export interface MetricData {
  name: string;
  description: string;
  unit: string;
  type: string;
  serviceName: string;
  resource: Record<string, unknown>;
  dataPoints: DataPoint[];
  receivedAt: string;
}

export interface LogData {
  timestamp: string;
  observedTimestamp: string;
  traceId: string;
  spanId: string;
  severityNumber: number;
  severityText: string;
  body: string;
  serviceName: string;
  attributes: Record<string, unknown>;
  resource: Record<string, unknown>;
}

export interface WsMessage {
  type: "traces" | "metrics" | "logs";
  data: TraceData | MetricData | LogData;
}
