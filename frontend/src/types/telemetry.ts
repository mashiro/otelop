export interface SpanEvent {
  name: string;
  timestamp: string;
  attributes: Record<string, unknown>;
}

// OTel span status is a closed enum on the backend (ptrace.StatusCode). Model
// it as a union so exhaustiveness checks in the UI catch missing cases.
export type SpanStatus = "Unset" | "Ok" | "Error";

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
  statusCode: SpanStatus;
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

// Distribution-only fields are null for Gauge/Sum. See schema.graphql for
// semantics of value/count/sum/min/max across metric types.
// The cumulative family carries raw running totals per series (attribute
// combination) "since otelop started observing"; they reset on daemon restart
// and are only populated for cumulative OTLP inputs the backend delta-izes.
export interface DataPoint {
  // Stable, globally unique identity (UUIDv7) assigned by the backend at
  // ingestion. Use it as the React key: it survives ring-buffer eviction and
  // reconnects, unlike timestamp/attributes (which can collide) or array index.
  id: string;
  timestamp: string;
  value: number;
  cumulative?: number | null;
  count?: number | null;
  countCumulative?: number | null;
  sum?: number | null;
  sumCumulative?: number | null;
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
  // Stable, globally unique identity (UUIDv7) assigned by the backend at
  // ingestion. Log records have no natural id, so use this as the React key:
  // it stays put as new logs are prepended, unlike an array index.
  id: string;
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
