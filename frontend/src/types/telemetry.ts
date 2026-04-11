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
  value: number;
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
