package broadcast

import (
	"context"
	"time"
)

// This file defines the WebSocket wire contract that
// frontend/src/types/telemetry.ts expects. It used to live in the old store package
// (deleted in docs/design/duckdb-storage.md Phase 5) as the Store's own
// marshaling types; broadcast now owns them directly since it is the only
// place that constructs these payloads. Struct fields and json tags are
// carried over verbatim — the frontend contract must not shift with the
// storage backend underneath it. Store-internal machinery that never
// marshaled (Merge, caches, RingBuffer indices) was dropped; see
// internal/broadcast/broadcast.go for how storage.* rows are translated into
// these shapes.

// SignalType identifies the type of telemetry signal carried by a broadcast
// message.
type SignalType string

const (
	SignalTraces       SignalType = "traces"
	SignalTraceDeletes SignalType = "trace-deletes"
	SignalMetrics      SignalType = "metrics"
	SignalLogs         SignalType = "logs"
)

type TraceDeleteData struct {
	TraceID string `json:"traceId"`
}

// OnAddFunc is called once per logical record (one distinct trace, one
// distinct (service, metric) pair, one log) as it is committed to storage.
// The ctx carries the ingest span so broadcast work shows up as a child in
// the trace. Callers (cmd/otelop) feed this into ws.Hub.Broadcast.
type OnAddFunc func(ctx context.Context, signalType SignalType, data any)

// TraceData represents a group of spans sharing the same trace ID.
type TraceData struct {
	TraceID      string             `json:"traceId"`
	RootSpan     *TraceRootSpanData `json:"rootSpan,omitempty"`
	Spans        []*SpanData        `json:"spans"`
	ServiceName  string             `json:"serviceName"`
	SearchValues []string           `json:"searchValues"`
	SpanCount    int                `json:"spanCount"`
	StartTime    time.Time          `json:"startTime"`
	// Duration is the full trace range (max end - min start) across every span,
	// never just the root span's duration. Codex-style traces can contain
	// multiple parentless spans or disconnected parent/child relationships;
	// anchoring Duration to a single root misreports the real trace length.
	Duration time.Duration `json:"duration"`
	// HasError is true when any span under this trace has StatusCode=="Error".
	HasError bool `json:"hasError"`
}

// TraceRootSpanData is the summary-only root shape needed by list rows and
// detail headers. Full span fields are fetched lazily through GraphQL.
type TraceRootSpanData struct {
	Name       string        `json:"name"`
	Kind       string        `json:"kind"`
	StatusCode string        `json:"statusCode"`
	Duration   time.Duration `json:"duration"`
}

// SpanData represents a single span.
type SpanData struct {
	TraceID      string         `json:"traceId"`
	SpanID       string         `json:"spanId"`
	ParentSpanID string         `json:"parentSpanId"`
	Name         string         `json:"name"`
	Kind         string         `json:"kind"`
	ServiceName  string         `json:"serviceName"`
	StartTime    time.Time      `json:"startTime"`
	EndTime      time.Time      `json:"endTime"`
	Duration     time.Duration  `json:"duration"`
	StatusCode   string         `json:"statusCode"`
	StatusMsg    string         `json:"statusMessage"`
	Attributes   map[string]any `json:"attributes"`
	Events       []SpanEvent    `json:"events"`
	Resource     map[string]any `json:"resource"`
}

// SpanEvent represents a span event (log-like annotation).
type SpanEvent struct {
	Name       string         `json:"name"`
	Timestamp  time.Time      `json:"timestamp"`
	Attributes map[string]any `json:"attributes"`
}

// MetricData represents a single metric with its data points.
type MetricData struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Unit        string         `json:"unit"`
	Type        string         `json:"type"`
	ServiceName string         `json:"serviceName"`
	Resource    map[string]any `json:"resource"`
	DataPoints  []DataPoint    `json:"dataPoints"`
	ReceivedAt  time.Time      `json:"receivedAt"`
}

// DataPoint is one observation in a metric series. For cumulative OTLP inputs
// (monotonic Sum, Histogram, Summary, ExponentialHistogram) the numeric
// fields carry per-interval deltas so the UI can show "what happened in this
// window" instead of running totals.
//
// Value is the primary chart scalar per type: instantaneous for Gauge, delta
// for Sum, per-window mean (sum/count) for Histogram/Summary/ExponentialHistogram.
// Count/Sum/Min/Max are only set for distribution types.
//
// Cumulative / CountCumulative / SumCumulative carry a running total "since
// otelop started observing", so consumers can display session totals without
// re-summing the delta column. For cumulative-temporality input it's the raw
// OTLP cumulative; for delta-temporality input otelop accumulates the deltas
// itself. Populated for monotonic Sum and for Histogram / Summary /
// ExponentialHistogram; null for Gauge and non-monotonic Sum.
type DataPoint struct {
	// ID is a stable, globally unique identity (a UUIDv7) minted at ingest, so
	// consumers (e.g. React keys) get a key that never collides and never
	// changes across WebSocket replay or persistence.
	ID              string         `json:"id"`
	SeriesKey       string         `json:"seriesKey"`
	Timestamp       time.Time      `json:"timestamp"`
	Value           float64        `json:"value"`
	Cumulative      *float64       `json:"cumulative,omitempty"`
	Count           *float64       `json:"count,omitempty"`
	CountCumulative *float64       `json:"countCumulative,omitempty"`
	Sum             *float64       `json:"sum,omitempty"`
	SumCumulative   *float64       `json:"sumCumulative,omitempty"`
	Min             *float64       `json:"min,omitempty"`
	Max             *float64       `json:"max,omitempty"`
	Attributes      map[string]any `json:"attributes"`
}

// LogData represents a single log record.
type LogData struct {
	// ID is a stable, globally unique identity (a UUIDv7) assigned at
	// ingestion. Log records have no natural id and can be byte-for-byte
	// identical, so this is the only durable key.
	ID                string         `json:"id"`
	Timestamp         time.Time      `json:"timestamp"`
	ObservedTimestamp time.Time      `json:"observedTimestamp"`
	TraceID           string         `json:"traceId"`
	SpanID            string         `json:"spanId"`
	SeverityNumber    int32          `json:"severityNumber"`
	SeverityText      string         `json:"severityText"`
	Body              string         `json:"body"`
	ServiceName       string         `json:"serviceName"`
	Attributes        map[string]any `json:"attributes"`
	Resource          map[string]any `json:"resource"`
}
