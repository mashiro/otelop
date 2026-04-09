package store

import (
	"sync"

	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

// SignalType identifies the type of telemetry signal.
type SignalType string

const (
	SignalTraces  SignalType = "traces"
	SignalMetrics SignalType = "metrics"
	SignalLogs    SignalType = "logs"
)

// OnAddFunc is called when new data is added to the store.
type OnAddFunc func(signalType SignalType, data any)

// Store holds telemetry data in bounded ring buffers.
type Store struct {
	mu      sync.RWMutex
	traces  *RingBuffer[*TraceData]
	metrics *RingBuffer[*MetricData]
	logs    *RingBuffer[*LogData]
	// traceIndex maps traceID to the index in the ring buffer for merging spans.
	traceIndex map[string]int
	// metricIndex maps "serviceName:metricName" to the index in the ring buffer for merging data points.
	metricIndex map[string]int
	onAdd       OnAddFunc
}

// NewStore creates a new Store with the given capacities.
func NewStore(traceCap, metricCap, logCap int, onAdd OnAddFunc) *Store {
	return &Store{
		traces:      NewRingBuffer[*TraceData](traceCap),
		metrics:     NewRingBuffer[*MetricData](metricCap),
		logs:        NewRingBuffer[*LogData](logCap),
		traceIndex:  make(map[string]int),
		metricIndex: make(map[string]int),
		onAdd:       onAdd,
	}
}

// AddTraces converts and stores trace data.
func (s *Store) AddTraces(td ptrace.Traces) {
	converted := ConvertTraces(td)
	s.mu.Lock()
	for _, trace := range converted {
		if idx, ok := s.traceIndex[trace.TraceID]; ok {
			// Merge spans into existing trace.
			existing := s.traces.Get(idx)
			if existing != nil {
				// Deduplicate spans by spanID.
				seen := make(map[string]struct{}, len(existing.Spans))
				for _, s := range existing.Spans {
					seen[s.SpanID] = struct{}{}
				}
				for _, s := range trace.Spans {
					if _, dup := seen[s.SpanID]; !dup {
						existing.Spans = append(existing.Spans, s)
						seen[s.SpanID] = struct{}{}
					}
				}
				existing.SpanCount = len(existing.Spans)
				if trace.RootSpan != nil {
					existing.RootSpan = trace.RootSpan
					existing.ServiceName = trace.ServiceName
					existing.Duration = trace.Duration
				}
				if trace.StartTime.Before(existing.StartTime) {
					existing.StartTime = trace.StartTime
				}
				continue
			}
		}
		idx := s.traces.Add(trace)
		s.traceIndex[trace.TraceID] = idx
	}
	s.mu.Unlock()

	if s.onAdd != nil {
		for _, trace := range converted {
			s.onAdd(SignalTraces, trace)
		}
	}
}

// metricKey returns the key used to identify a unique metric series.
func metricKey(serviceName, name string) string {
	return serviceName + "\x00" + name
}

// AddMetrics converts and stores metric data, merging data points for the same metric.
func (s *Store) AddMetrics(md pmetric.Metrics) {
	converted := ConvertMetrics(md)
	s.mu.Lock()
	for _, m := range converted {
		key := metricKey(m.ServiceName, m.Name)
		if idx, ok := s.metricIndex[key]; ok {
			existing := s.metrics.Get(idx)
			if existing != nil {
				existing.DataPoints = append(existing.DataPoints, m.DataPoints...)
				existing.ReceivedAt = m.ReceivedAt
				continue
			}
		}
		idx := s.metrics.Add(m)
		s.metricIndex[key] = idx
	}
	s.mu.Unlock()

	if s.onAdd != nil {
		for _, m := range converted {
			s.onAdd(SignalMetrics, m)
		}
	}
}

// AddLogs converts and stores log data.
func (s *Store) AddLogs(ld plog.Logs) {
	converted := ConvertLogs(ld)
	s.mu.Lock()
	for _, l := range converted {
		s.logs.Add(l)
	}
	s.mu.Unlock()

	if s.onAdd != nil {
		for _, l := range converted {
			s.onAdd(SignalLogs, l)
		}
	}
}

// GetTraces returns all stored traces, newest first.
func (s *Store) GetTraces() []*TraceData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := s.traces.Items()
	// Reverse to return newest first.
	reversed := make([]*TraceData, len(items))
	for i, item := range items {
		reversed[len(items)-1-i] = item
	}
	return reversed
}

// GetMetrics returns all stored metrics, newest first.
func (s *Store) GetMetrics() []*MetricData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := s.metrics.Items()
	reversed := make([]*MetricData, len(items))
	for i, item := range items {
		reversed[len(items)-1-i] = item
	}
	return reversed
}

// GetLogs returns all stored logs, newest first.
func (s *Store) GetLogs() []*LogData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := s.logs.Items()
	reversed := make([]*LogData, len(items))
	for i, item := range items {
		reversed[len(items)-1-i] = item
	}
	return reversed
}

// GetTraceByID returns a trace by its trace ID.
func (s *Store) GetTraceByID(traceID string) (*TraceData, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if idx, ok := s.traceIndex[traceID]; ok {
		if item := s.traces.Get(idx); item != nil {
			return item, true
		}
	}
	// Fallback: linear scan (in case index is stale after ring buffer wrap).
	for _, item := range s.traces.Items() {
		if item.TraceID == traceID {
			return item, true
		}
	}
	return nil, false
}

// Clear removes all data from the store.
func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.traces.Clear()
	s.metrics.Clear()
	s.logs.Clear()
	s.traceIndex = make(map[string]int)
	s.metricIndex = make(map[string]int)
}

// RingBuffer is a generic bounded FIFO buffer.
type RingBuffer[T any] struct {
	items []T
	head  int
	count int
	cap   int
}

// NewRingBuffer creates a new RingBuffer with the given capacity.
func NewRingBuffer[T any](cap int) *RingBuffer[T] {
	return &RingBuffer[T]{
		items: make([]T, cap),
		cap:   cap,
	}
}

// Add appends an item to the buffer, overwriting the oldest if full.
// Returns the index at which the item was stored.
func (rb *RingBuffer[T]) Add(item T) int {
	idx := (rb.head + rb.count) % rb.cap
	if rb.count == rb.cap {
		// Buffer is full, overwrite oldest.
		idx = rb.head
		rb.head = (rb.head + 1) % rb.cap
	} else {
		rb.count++
	}
	rb.items[idx] = item
	return idx
}

// Get returns the item at the given absolute index, or the zero value if invalid.
func (rb *RingBuffer[T]) Get(idx int) T {
	if idx < 0 || idx >= rb.cap {
		var zero T
		return zero
	}
	return rb.items[idx]
}

// Items returns all items in insertion order (oldest first).
func (rb *RingBuffer[T]) Items() []T {
	result := make([]T, rb.count)
	for i := 0; i < rb.count; i++ {
		result[i] = rb.items[(rb.head+i)%rb.cap]
	}
	return result
}

// Len returns the number of items in the buffer.
func (rb *RingBuffer[T]) Len() int {
	return rb.count
}

// Clear removes all items from the buffer.
func (rb *RingBuffer[T]) Clear() {
	var zero T
	for i := range rb.items {
		rb.items[i] = zero
	}
	rb.head = 0
	rb.count = 0
}
