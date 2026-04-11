package store

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// defaultSeriesTTL is how long an unobserved entry lingers before being
	// pruned. Lazy — only runs on writes.
	defaultSeriesTTL = 10 * time.Minute
	// defaultSeriesMaxEntries caps how many series the store tracks so a
	// high-cardinality attribute (e.g. request_id) can't leak memory. The
	// oldest-lastSeen entry is evicted when the cap is hit.
	defaultSeriesMaxEntries = 50_000
)

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
	mu         sync.Mutex
	entries    map[string]*seriesState
	ttl        time.Duration
	maxEntries int
	lastPrune  time.Time
}

func newSeriesStore() *seriesStore {
	return &seriesStore{
		entries:    make(map[string]*seriesState),
		ttl:        defaultSeriesTTL,
		maxEntries: defaultSeriesMaxEntries,
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
		s.admitLocked(key, &seriesState{lastSeen: now, value: rawValue, hasValue: true})
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
		s.admitLocked(key, &seriesState{
			lastSeen: now,
			count:    rawCount,
			hasCount: true,
			sum:      rawSum,
			hasSum:   true,
		})
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

// admitLocked inserts a new entry, evicting the oldest-lastSeen entry when
// the cap is hit. O(N) on eviction but only fires when the map is full, so
// steady-state cost is O(1).
func (s *seriesStore) admitLocked(key string, state *seriesState) {
	if s.maxEntries > 0 && len(s.entries) >= s.maxEntries {
		var oldestKey string
		var oldestSeen time.Time
		for k, v := range s.entries {
			if oldestKey == "" || v.lastSeen.Before(oldestSeen) {
				oldestKey = k
				oldestSeen = v.lastSeen
			}
		}
		delete(s.entries, oldestKey)
	}
	s.entries[key] = state
}

// pruneLocked drops entries older than the TTL. Rate-limited to once per
// ttl/10 so a single scrape burst doesn't turn into O(N²) scans.
func (s *seriesStore) pruneLocked(now time.Time) {
	if s.ttl <= 0 {
		return
	}
	interval := s.ttl / 10
	if interval < time.Second {
		interval = time.Second
	}
	if !s.lastPrune.IsZero() && now.Sub(s.lastPrune) < interval {
		return
	}
	s.lastPrune = now
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
