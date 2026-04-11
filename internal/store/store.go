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

// OnAddFunc is called when new data is added to the store. It runs outside the
// store's write lock so implementations may take their time (e.g. serialize
// and broadcast over a WebSocket).
type OnAddFunc func(signalType SignalType, data any)

// Store holds telemetry data in bounded ring buffers keyed for O(1) upsert.
type Store struct {
	mu            sync.RWMutex
	traces        *RingBuffer[*TraceData]
	metrics       *RingBuffer[*MetricData]
	logs          *RingBuffer[*LogData]
	traceIndex    map[string]int
	metricIndex   map[string]int
	series        *seriesStore
	maxDataPoints int
	onAdd         OnAddFunc
}

// NewStore creates a new Store with the given capacities.
func NewStore(traceCap, metricCap, logCap, maxDataPoints int, onAdd OnAddFunc) *Store {
	if maxDataPoints <= 0 {
		maxDataPoints = DefaultMaxDataPoints
	}
	return &Store{
		traces:        NewRingBuffer[*TraceData](traceCap),
		metrics:       NewRingBuffer[*MetricData](metricCap),
		logs:          NewRingBuffer[*LogData](logCap),
		traceIndex:    make(map[string]int, traceCap),
		metricIndex:   make(map[string]int, metricCap),
		series:        newSeriesStore(),
		maxDataPoints: maxDataPoints,
		onAdd:         onAdd,
	}
}

// DefaultMaxDataPoints is the default cap for data points per metric.
const DefaultMaxDataPoints = 1000

// metricKey returns the key used to identify a unique metric series.
func metricKey(serviceName, name string) string {
	return serviceName + "\x00" + name
}

// AddTraces converts and stores trace data. Broadcasts fire outside the lock.
func (s *Store) AddTraces(td ptrace.Traces) {
	converted := ConvertTraces(td)
	if len(converted) == 0 {
		return
	}

	notify := make([]*TraceData, 0, len(converted))
	s.mu.Lock()
	for _, trace := range converted {
		if idx, ok := s.traceIndex[trace.TraceID]; ok {
			if existing := s.traces.Get(idx); existing != nil && existing.TraceID == trace.TraceID {
				existing.Merge(trace)
				notify = append(notify, existing)
				continue
			}
			// index was stale — fall through to re-insert
			delete(s.traceIndex, trace.TraceID)
		}
		idx, evicted, wasEvicted := s.traces.Add(trace)
		if wasEvicted && evicted != nil {
			delete(s.traceIndex, evicted.TraceID)
		}
		s.traceIndex[trace.TraceID] = idx
		notify = append(notify, trace)
	}
	s.mu.Unlock()

	if s.onAdd != nil {
		for _, trace := range notify {
			s.onAdd(SignalTraces, trace)
		}
	}
}

// AddMetrics converts and stores metric data, merging data points for the same metric.
func (s *Store) AddMetrics(md pmetric.Metrics) {
	converted := ConvertMetrics(md, s.series)
	if len(converted) == 0 {
		return
	}

	notify := make([]*MetricData, 0, len(converted))
	s.mu.Lock()
	for _, m := range converted {
		key := metricKey(m.ServiceName, m.Name)
		if idx, ok := s.metricIndex[key]; ok {
			if existing := s.metrics.Get(idx); existing != nil && existing.Name == m.Name && existing.ServiceName == m.ServiceName {
				existing.DataPoints = append(existing.DataPoints, m.DataPoints...)
				if len(existing.DataPoints) > s.maxDataPoints {
					existing.DataPoints = existing.DataPoints[len(existing.DataPoints)-s.maxDataPoints:]
				}
				existing.ReceivedAt = m.ReceivedAt
				notify = append(notify, existing)
				continue
			}
			delete(s.metricIndex, key)
		}
		idx, evicted, wasEvicted := s.metrics.Add(m)
		if wasEvicted && evicted != nil {
			delete(s.metricIndex, metricKey(evicted.ServiceName, evicted.Name))
		}
		s.metricIndex[key] = idx
		notify = append(notify, m)
	}
	s.mu.Unlock()

	if s.onAdd != nil {
		for _, m := range notify {
			s.onAdd(SignalMetrics, m)
		}
	}
}

// AddLogs converts and stores log data.
func (s *Store) AddLogs(ld plog.Logs) {
	converted := ConvertLogs(ld)
	if len(converted) == 0 {
		return
	}

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

// GetTracesPage returns a newest-first page of traces plus the total buffer count.
func (s *Store) GetTracesPage(offset, limit int) (items []*TraceData, total int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.traces.Page(offset, limit)
}

// GetMetricsPage returns a newest-first page of metrics plus the total buffer count.
func (s *Store) GetMetricsPage(offset, limit int) (items []*MetricData, total int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.metrics.Page(offset, limit)
}

// GetLogsPage returns a newest-first page of logs plus the total buffer count.
func (s *Store) GetLogsPage(offset, limit int) (items []*LogData, total int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.logs.Page(offset, limit)
}

// GetLogsPageByTraceID returns a newest-first page of logs whose TraceID
// matches traceID, with offset/limit applied to the filtered set. There is no
// traceID index on logs, so this scans the whole buffer under the read lock.
// Callers rely on this for the trace↔log correlation join.
func (s *Store) GetLogsPageByTraceID(traceID string, offset, limit int) (items []*LogData, total int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	all, _ := s.logs.Page(0, 0)
	filtered := make([]*LogData, 0, len(all))
	for _, l := range all {
		if l.TraceID == traceID {
			filtered = append(filtered, l)
		}
	}
	total = len(filtered)
	if offset < 0 {
		offset = 0
	}
	if offset >= total {
		return []*LogData{}, total
	}
	end := total
	if limit > 0 && offset+limit < end {
		end = offset + limit
	}
	return filtered[offset:end], total
}

// GetTraces returns all stored traces, newest first.
func (s *Store) GetTraces() []*TraceData {
	items, _ := s.GetTracesPage(0, 0)
	return items
}

// GetMetrics returns all stored metrics, newest first.
func (s *Store) GetMetrics() []*MetricData {
	items, _ := s.GetMetricsPage(0, 0)
	return items
}

// GetLogs returns all stored logs, newest first.
func (s *Store) GetLogs() []*LogData {
	items, _ := s.GetLogsPage(0, 0)
	return items
}

// GetTraceByID returns a trace by its trace ID. Lookup is O(1) — the index is
// kept in sync with the ring buffer via eviction callbacks in AddTraces.
func (s *Store) GetTraceByID(traceID string) (*TraceData, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	idx, ok := s.traceIndex[traceID]
	if !ok {
		return nil, false
	}
	item := s.traces.Get(idx)
	if item == nil || item.TraceID != traceID {
		return nil, false
	}
	return item, true
}

// Capacity returns the store's configured limits.
func (s *Store) Capacity() (traceCap, metricCap, logCap, maxDataPoints int) {
	return s.traces.cap, s.metrics.cap, s.logs.cap, s.maxDataPoints
}

// Len returns the current number of items in each buffer.
func (s *Store) Len() (traces, metrics, logs int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.traces.Len(), s.metrics.Len(), s.logs.Len()
}

// Clear removes all data from the store.
func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.traces.Clear()
	s.metrics.Clear()
	s.logs.Clear()
	clear(s.traceIndex)
	clear(s.metricIndex)
	s.series.clear()
}

// RingBuffer is a generic bounded FIFO buffer. Not safe for concurrent use —
// callers (e.g. Store) synchronize externally.
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

// Add appends an item to the buffer, overwriting the oldest if full. It returns
// the stored index, the evicted value (zero if none), and whether an eviction
// happened — giving callers enough to maintain secondary indexes.
func (rb *RingBuffer[T]) Add(item T) (idx int, evicted T, wasEvicted bool) {
	if rb.count == rb.cap {
		idx = rb.head
		evicted = rb.items[idx]
		wasEvicted = true
		rb.head = (rb.head + 1) % rb.cap
	} else {
		idx = (rb.head + rb.count) % rb.cap
		rb.count++
	}
	rb.items[idx] = item
	return
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

// Page returns up to `limit` items starting at `offset` counted from the newest.
// When limit == 0, all items from offset to the end are returned. `total` is the
// total number of items currently stored. The returned slice is always non-nil
// (empty when there is nothing to return) so JSON-marshaled API responses emit
// `[]` rather than `null`, and never aliases the underlying buffer.
func (rb *RingBuffer[T]) Page(offset, limit int) (items []T, total int) {
	total = rb.count
	if offset < 0 {
		offset = 0
	}
	if offset >= total {
		return []T{}, total
	}
	end := total
	if limit > 0 && offset+limit < end {
		end = offset + limit
	}
	n := end - offset
	items = make([]T, n)
	// Position of newest item: (head + count - 1) mod cap. Step backwards.
	// Use +rb.cap before modulo to avoid negative intermediates.
	for i := 0; i < n; i++ {
		rank := offset + i
		pos := (rb.head + rb.count - 1 - rank + rb.cap) % rb.cap
		items[i] = rb.items[pos]
	}
	return
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
