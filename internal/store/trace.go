package store

import (
	"time"

	"go.opentelemetry.io/collector/pdata/ptrace"
)

// TraceData represents a group of spans sharing the same trace ID.
type TraceData struct {
	TraceID     string      `json:"traceId"`
	RootSpan    *SpanData   `json:"rootSpan,omitempty"`
	Spans       []*SpanData `json:"spans"`
	ServiceName string      `json:"serviceName"`
	SpanCount   int         `json:"spanCount"`
	StartTime   time.Time   `json:"startTime"`
	// Duration is the full trace range (max end - min start) across every span,
	// never just the root span's duration. Codex-style traces can contain
	// multiple parentless spans or disconnected parent/child relationships;
	// anchoring Duration to a single root misreports the real trace length.
	Duration time.Duration `json:"duration"`
	// HasError is true when any span under this trace has StatusCode=="Error".
	// Maintained incrementally in ConvertTraces/Merge so HasError GraphQL
	// resolutions don't rescan Spans on every query.
	HasError bool `json:"hasError"`

	// Cached so Merge can extend Duration incrementally without rescanning spans.
	endTime time.Time
	// spanIDs tracks known spanIDs for O(1) deduplication on merge. Not serialized.
	spanIDs map[string]struct{} `json:"-"`
	// spanByID supports O(1) parent lookup from SpanResolver.Parent. Built lazily
	// on first access and invalidated whenever Merge appends new spans.
	spanByID map[string]*SpanData `json:"-"`
}

// Merge incorporates another TraceData sharing the same TraceID, deduplicating spans.
func (t *TraceData) Merge(other *TraceData) {
	if t.spanIDs == nil {
		t.spanIDs = make(map[string]struct{}, len(t.Spans)+len(other.Spans))
		for _, s := range t.Spans {
			t.spanIDs[s.SpanID] = struct{}{}
			if s.EndTime.After(t.endTime) {
				t.endTime = s.EndTime
			}
			if s.StatusCode == spanStatusErrorLiteral {
				t.HasError = true
			}
		}
	}
	for _, s := range other.Spans {
		if _, dup := t.spanIDs[s.SpanID]; dup {
			continue
		}
		t.spanIDs[s.SpanID] = struct{}{}
		t.Spans = append(t.Spans, s)
		if s.StartTime.Before(t.StartTime) || t.StartTime.IsZero() {
			t.StartTime = s.StartTime
		}
		if s.EndTime.After(t.endTime) {
			t.endTime = s.EndTime
		}
		if s.StatusCode == spanStatusErrorLiteral {
			t.HasError = true
		}
	}
	// Parent map is invalidated because new spans may have arrived. It will be
	// rebuilt lazily on the next SpanByID call.
	t.spanByID = nil
	t.SpanCount = len(t.Spans)
	if other.RootSpan != nil && isBetterRoot(t.RootSpan, other.RootSpan) {
		t.RootSpan = other.RootSpan
		t.ServiceName = other.ServiceName
	}
	if t.endTime.After(t.StartTime) {
		t.Duration = t.endTime.Sub(t.StartTime)
	}
}

// When a trace has multiple parentless spans we pick the longest one so the
// displayed span name/status roughly reflects the dominant operation.
func isBetterRoot(current, candidate *SpanData) bool {
	if current == nil {
		return true
	}
	return candidate.Duration > current.Duration
}

// spanStatusErrorLiteral mirrors ptrace.StatusCodeError.String() so HasError
// bookkeeping inside the store package doesn't need to import pdata.
const spanStatusErrorLiteral = "Error"

// SpanByID returns the span with the given SpanID within this trace, or nil
// when no such span has been buffered. The lookup map is built lazily on the
// first call and reused until Merge appends new spans.
func (t *TraceData) SpanByID(id string) *SpanData {
	if id == "" {
		return nil
	}
	if t.spanByID == nil {
		t.spanByID = make(map[string]*SpanData, len(t.Spans))
		for _, s := range t.Spans {
			t.spanByID[s.SpanID] = s
		}
	}
	return t.spanByID[id]
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
						endTime:   sd.EndTime,
					}
					index[traceID] = trace
					result = append(result, trace)
				}

				trace.Spans = append(trace.Spans, sd)
				trace.SpanCount = len(trace.Spans)

				if sd.StartTime.Before(trace.StartTime) {
					trace.StartTime = sd.StartTime
				}
				if sd.EndTime.After(trace.endTime) {
					trace.endTime = sd.EndTime
				}
				if sd.StatusCode == spanStatusErrorLiteral {
					trace.HasError = true
				}

				if span.ParentSpanID().IsEmpty() && isBetterRoot(trace.RootSpan, sd) {
					trace.RootSpan = sd
					trace.ServiceName = svcName
				}
			}
		}
	}

	for _, trace := range result {
		if len(trace.Spans) == 0 {
			continue
		}
		if trace.endTime.After(trace.StartTime) {
			trace.Duration = trace.endTime.Sub(trace.StartTime)
		}
		if trace.ServiceName == "" {
			// For rootless traces, derive the label from the earliest-started
			// span rather than ingestion order so out-of-order resource batches
			// don't mislabel the trace.
			earliest := trace.Spans[0]
			for _, s := range trace.Spans[1:] {
				if s.StartTime.Before(earliest.StartTime) {
					earliest = s
				}
			}
			trace.ServiceName = earliest.ServiceName
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
