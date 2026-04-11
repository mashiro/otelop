package store

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// defaultSeriesTTL is how long a series entry lingers without being observed
// before it's considered abandoned. Abandoned entries are pruned lazily on
// writes so stale label sets don't leak forever.
const defaultSeriesTTL = 10 * time.Minute

// seriesState is the last raw (un-converted) OTLP observation of one metric
// series. We keep it so cumulative -> delta conversion is a pure function
// from (previous state, current raw point) to the delta to emit.
type seriesState struct {
	lastSeen time.Time

	// For Sum / Gauge / number types.
	value    float64
	hasValue bool

	// For Histogram / ExponentialHistogram / Summary.
	count    uint64
	hasCount bool
	sum      float64
	hasSum   bool
}

// seriesStore tracks the last raw snapshot per metric series so
// Store.AddMetrics can delta-ize cumulative OTLP input before it reaches the
// ring buffer. Safe for concurrent use on its own, but in practice callers
// (Store) already hold their own lock during ingest.
type seriesStore struct {
	mu      sync.Mutex
	entries map[string]*seriesState
	ttl     time.Duration
}

func newSeriesStore() *seriesStore {
	return &seriesStore{
		entries: make(map[string]*seriesState),
		ttl:     defaultSeriesTTL,
	}
}

// seriesKey builds a stable lookup key for a metric series. Attributes are
// sorted so callers don't have to think about insertion order.
func seriesKey(serviceName, metricName string, attrs map[string]any) string {
	var b strings.Builder
	b.WriteString(serviceName)
	b.WriteByte(0)
	b.WriteString(metricName)
	b.WriteByte(0)
	if len(attrs) > 0 {
		keys := make([]string, 0, len(attrs))
		for k := range attrs {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			b.WriteString(k)
			b.WriteByte('=')
			b.WriteString(stringifyAttr(attrs[k]))
			b.WriteByte(0)
		}
	}
	return b.String()
}

func stringifyAttr(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case int:
		return strconv.Itoa(x)
	case float64:
		return strconv.FormatFloat(x, 'g', -1, 64)
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", x)
	}
}

// numberDelta returns the delta from the previous raw value to rawValue and
// updates the stored snapshot. If there is no prior snapshot, or the new
// value is smaller (counter reset), it records the baseline and returns
// ok=false so the caller can drop the point.
func (s *seriesStore) numberDelta(key string, rawValue float64, now time.Time) (delta float64, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(now)
	entry, exists := s.entries[key]
	if !exists {
		s.entries[key] = &seriesState{lastSeen: now, value: rawValue, hasValue: true}
		return 0, false
	}
	entry.lastSeen = now
	if !entry.hasValue || rawValue < entry.value {
		entry.value = rawValue
		entry.hasValue = true
		return 0, false
	}
	delta = rawValue - entry.value
	entry.value = rawValue
	return delta, true
}

// histogramDelta returns (countDelta, sumDelta) and updates the stored
// snapshot. Same reset semantics as numberDelta.
func (s *seriesStore) histogramDelta(key string, rawCount uint64, rawSum float64, now time.Time) (countDelta uint64, sumDelta float64, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(now)
	entry, exists := s.entries[key]
	if !exists {
		s.entries[key] = &seriesState{
			lastSeen: now,
			count:    rawCount,
			hasCount: true,
			sum:      rawSum,
			hasSum:   true,
		}
		return 0, 0, false
	}
	entry.lastSeen = now
	if !entry.hasCount || rawCount < entry.count {
		entry.count = rawCount
		entry.hasCount = true
		entry.sum = rawSum
		entry.hasSum = true
		return 0, 0, false
	}
	countDelta = rawCount - entry.count
	sumDelta = rawSum - entry.sum
	entry.count = rawCount
	entry.sum = rawSum
	return countDelta, sumDelta, true
}

// pruneLocked drops entries older than the TTL. Called on every mutation so
// the map shrinks naturally without a background goroutine.
func (s *seriesStore) pruneLocked(now time.Time) {
	if s.ttl <= 0 {
		return
	}
	cutoff := now.Add(-s.ttl)
	for k, v := range s.entries {
		if v.lastSeen.Before(cutoff) {
			delete(s.entries, k)
		}
	}
}

// clear drops every tracked series. Used by Store.Clear to keep ring buffer
// and series state in sync.
func (s *seriesStore) clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	clear(s.entries)
}

// len returns the number of tracked series; exposed for tests.
func (s *seriesStore) len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.entries)
}
