package store

import (
	"time"

	"go.opentelemetry.io/collector/pdata/ptrace"
)

// TraceData represents a group of spans sharing the same trace ID.
type TraceData struct {
	TraceID     string      `json:"traceID"`
	RootSpan    *SpanData   `json:"rootSpan,omitempty"`
	Spans       []*SpanData `json:"spans"`
	ServiceName string      `json:"serviceName"`
	SpanCount   int         `json:"spanCount"`
	StartTime   time.Time   `json:"startTime"`
	Duration    time.Duration `json:"duration"`
}

// SpanData represents a single span.
type SpanData struct {
	TraceID      string         `json:"traceID"`
	SpanID       string         `json:"spanID"`
	ParentSpanID string         `json:"parentSpanID"`
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

// ConvertTraces converts ptrace.Traces into a map of TraceData keyed by trace ID.
func ConvertTraces(td ptrace.Traces) map[string]*TraceData {
	result := make(map[string]*TraceData)

	for i := 0; i < td.ResourceSpans().Len(); i++ {
		rs := td.ResourceSpans().At(i)
		resource := attributesToMap(rs.Resource().Attributes())
		var svcName string
		if serviceName, ok := rs.Resource().Attributes().Get("service.name"); ok {
			svcName = serviceName.AsString()
		}

		for j := 0; j < rs.ScopeSpans().Len(); j++ {
			ss := rs.ScopeSpans().At(j)
			for k := 0; k < ss.Spans().Len(); k++ {
				span := ss.Spans().At(k)
				traceID := span.TraceID().String()

				sd := &SpanData{
					TraceID:      traceID,
					SpanID:       span.SpanID().String(),
					ParentSpanID: span.ParentSpanID().String(),
					Name:         span.Name(),
					Kind:         span.Kind().String(),
					ServiceName:  svcName,
					StartTime:    span.StartTimestamp().AsTime(),
					EndTime:      span.EndTimestamp().AsTime(),
					Duration:     span.EndTimestamp().AsTime().Sub(span.StartTimestamp().AsTime()),
					StatusCode:   span.Status().Code().String(),
					StatusMsg:    span.Status().Message(),
					Attributes:   attributesToMap(span.Attributes()),
					Events:       convertSpanEvents(span.Events()),
					Resource:     resource,
				}

				trace, ok := result[traceID]
				if !ok {
					trace = &TraceData{
						TraceID:   traceID,
						StartTime: sd.StartTime,
					}
					result[traceID] = trace
				}

				trace.Spans = append(trace.Spans, sd)
				trace.SpanCount = len(trace.Spans)

				if sd.StartTime.Before(trace.StartTime) {
					trace.StartTime = sd.StartTime
				}

				// Root span: no parent
				if span.ParentSpanID().IsEmpty() {
					trace.RootSpan = sd
					trace.ServiceName = svcName
					trace.Duration = sd.Duration
				}
			}
		}
	}

	// For traces without a root span, derive service name and duration from the earliest span.
	for _, trace := range result {
		if trace.RootSpan == nil && len(trace.Spans) > 0 {
			earliest := trace.Spans[0]
			latest := trace.Spans[0]
			for _, s := range trace.Spans[1:] {
				if s.StartTime.Before(earliest.StartTime) {
					earliest = s
				}
				if s.EndTime.After(latest.EndTime) {
					latest = s
				}
			}
			trace.ServiceName = earliest.ServiceName
			trace.Duration = latest.EndTime.Sub(earliest.StartTime)
		}
	}

	return result
}

func convertSpanEvents(events ptrace.SpanEventSlice) []SpanEvent {
	result := make([]SpanEvent, 0, events.Len())
	for i := 0; i < events.Len(); i++ {
		e := events.At(i)
		result = append(result, SpanEvent{
			Name:       e.Name(),
			Timestamp:  e.Timestamp().AsTime(),
			Attributes: attributesToMap(e.Attributes()),
		})
	}
	return result
}
