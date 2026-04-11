package store

import (
	"time"

	"go.opentelemetry.io/collector/pdata/ptrace"
)

// TraceData represents a group of spans sharing the same trace ID.
type TraceData struct {
	TraceID     string        `json:"traceID"`
	RootSpan    *SpanData     `json:"rootSpan,omitempty"`
	Spans       []*SpanData   `json:"spans"`
	ServiceName string        `json:"serviceName"`
	SpanCount   int           `json:"spanCount"`
	StartTime   time.Time     `json:"startTime"`
	Duration    time.Duration `json:"duration"`

	// spanIDs tracks known spanIDs for O(1) deduplication on merge. Not serialized.
	spanIDs map[string]struct{} `json:"-"`
}

// Merge incorporates another TraceData sharing the same TraceID, deduplicating spans.
func (t *TraceData) Merge(other *TraceData) {
	if t.spanIDs == nil {
		t.spanIDs = make(map[string]struct{}, len(t.Spans)+len(other.Spans))
		for _, s := range t.Spans {
			t.spanIDs[s.SpanID] = struct{}{}
		}
	}
	for _, s := range other.Spans {
		if _, dup := t.spanIDs[s.SpanID]; dup {
			continue
		}
		t.spanIDs[s.SpanID] = struct{}{}
		t.Spans = append(t.Spans, s)
	}
	t.SpanCount = len(t.Spans)
	if other.RootSpan != nil {
		t.RootSpan = other.RootSpan
		t.ServiceName = other.ServiceName
		t.Duration = other.Duration
	}
	if !other.StartTime.IsZero() && other.StartTime.Before(t.StartTime) {
		t.StartTime = other.StartTime
	}
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

// ConvertTraces converts ptrace.Traces into a slice of TraceData, grouped by trace ID.
// The returned slice preserves first-seen order, which callers rely on for deterministic
// ingestion into the store.
func ConvertTraces(td ptrace.Traces) []*TraceData {
	var result []*TraceData
	index := make(map[string]*TraceData)

	resourceSpans := td.ResourceSpans()
	for i := 0; i < resourceSpans.Len(); i++ {
		rs := resourceSpans.At(i)
		resource := attributesToMap(rs.Resource().Attributes())
		var svcName string
		if serviceName, ok := rs.Resource().Attributes().Get("service.name"); ok {
			svcName = serviceName.AsString()
		}

		scopeSpans := rs.ScopeSpans()
		for j := 0; j < scopeSpans.Len(); j++ {
			spans := scopeSpans.At(j).Spans()
			for k := 0; k < spans.Len(); k++ {
				span := spans.At(k)
				traceID := span.TraceID().String()
				start := span.StartTimestamp().AsTime()
				end := span.EndTimestamp().AsTime()

				sd := &SpanData{
					TraceID:      traceID,
					SpanID:       span.SpanID().String(),
					ParentSpanID: span.ParentSpanID().String(),
					Name:         span.Name(),
					Kind:         span.Kind().String(),
					ServiceName:  svcName,
					StartTime:    start,
					EndTime:      end,
					Duration:     end.Sub(start),
					StatusCode:   span.Status().Code().String(),
					StatusMsg:    span.Status().Message(),
					Attributes:   attributesToMap(span.Attributes()),
					Events:       convertSpanEvents(span.Events()),
					Resource:     resource,
				}

				trace, ok := index[traceID]
				if !ok {
					trace = &TraceData{
						TraceID:   traceID,
						StartTime: sd.StartTime,
					}
					index[traceID] = trace
					result = append(result, trace)
				}

				trace.Spans = append(trace.Spans, sd)
				trace.SpanCount = len(trace.Spans)

				if sd.StartTime.Before(trace.StartTime) {
					trace.StartTime = sd.StartTime
				}

				if span.ParentSpanID().IsEmpty() {
					trace.RootSpan = sd
					trace.ServiceName = svcName
					trace.Duration = sd.Duration
				}
			}
		}
	}

	// For traces without an explicit root span, derive service name and duration
	// from the earliest/latest span in a single pass.
	for _, trace := range result {
		if trace.RootSpan != nil || len(trace.Spans) == 0 {
			continue
		}
		earliest := trace.Spans[0]
		latestEnd := earliest.EndTime
		for _, s := range trace.Spans[1:] {
			if s.StartTime.Before(earliest.StartTime) {
				earliest = s
			}
			if s.EndTime.After(latestEnd) {
				latestEnd = s.EndTime
			}
		}
		trace.ServiceName = earliest.ServiceName
		trace.Duration = latestEnd.Sub(earliest.StartTime)
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
