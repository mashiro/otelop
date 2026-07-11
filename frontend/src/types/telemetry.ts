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

// Trace list/detail-header display fields for the trace's representative
// root span (the parentless span with the longest duration — see the Go
// resolver's pickRootSpan). Deliberately narrower than SpanData: the
// GraphQL trace-list query (use-initial-load.ts) resolves these straight
// from the backend's TracesPage summary row without the per-trace detail
// fetch that spanId/attributes/events/etc. would require (see
// internal/graphql/trace_resolver.go), so only fetch fields the summary
// actually carries. Nothing downstream needs more than this to render a
// list row or a detail header — full span data comes from `trace.spans`
// once the detail view lazily fetches it.
export interface TraceRootSpan {
  name: string;
  kind: string;
  statusCode: SpanStatus;
  duration: number;
}

export interface TraceData {
  traceId: string;
  rootSpan?: TraceRootSpan;
  // Empty until the trace detail view lazily fetches it (see
  // hooks/use-trace-spans.ts) — the initial trace-list load only fetches
  // summary fields (spanCount, duration, rootSpan) to avoid re-triggering
  // the N+1 TraceByID fetch across every buffered trace. Never derive a
  // trace's span count or duration from spans.length/spans — use spanCount/
  // duration below, which are always populated from the list query.
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
  // Empty until a detail view fetches history (hooks/use-metric-range-points.ts)
  // or a WS delivery merges points in (stores/telemetry.ts's addMetricAtom) —
  // the initial metrics-list load only fetches pointCount/latestValue below
  // (issue #162), never the full series, to avoid an N-metric fetch of every
  // group's entire retained history just to render list rows.
  dataPoints: DataPoint[];
  // Cheap server-computed summary fields the metrics LIST renders instead of
  // dataPoints.length / dataPoints.at(-1)?.value (see MetricList) — kept
  // current across a WS delivery by addMetricAtom's genuinely-new-points
  // delta, the same "don't trust the wire payload, derive it" pattern the
  // header badge totals use (see stores/telemetry.ts's totalMetricCountAtom).
  pointCount: number;
  latestValue: number | null;
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
