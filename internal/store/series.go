package store

import (
	"fmt"
	"hash/maphash"
	"sort"
	"strconv"
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

// seriesState is the running per-series bookkeeping we keep across scrapes.
// For cumulative-temporality input value/count/sum hold the last raw
// observation; for delta-temporality input they hold the accumulated total
// since otelop started observing. A series is only ever one temporality so
// the two uses never mix within one entry.
type seriesState struct {
	lastSeen time.Time
	// Sum / Gauge / number types.
	value float64
	// Histogram / ExponentialHistogram / Summary.
	count uint64
	sum   float64
}

// seriesStore tracks the last raw snapshot per metric series so
// Store.AddMetrics can delta-ize cumulative OTLP input before it reaches the
// ring buffer. Safe for concurrent use on its own, but in practice callers
// (Store) already hold their own lock during ingest.
type seriesStore struct {
	mu         sync.Mutex
	entries    map[uint64]*seriesState
	ttl        time.Duration
	maxEntries int
	lastPrune  time.Time
}

func newSeriesStore() *seriesStore {
	return &seriesStore{
		entries:    make(map[uint64]*seriesState),
		ttl:        defaultSeriesTTL,
		maxEntries: defaultSeriesMaxEntries,
	}
}

// seriesKeySeed is chosen once per process — the series store never leaves
// memory, so a process-local keyspace is all we need.
var seriesKeySeed = maphash.MakeSeed()

// seriesKey builds a stable 64-bit hash key for a metric series. Attributes
// are sorted before hashing so callers don't have to think about insertion
// order. Returning a uint64 instead of a string avoids allocating a fresh
// key string on every ingested data point.
func seriesKey(serviceName, metricName string, attrs map[string]any) uint64 {
	var h maphash.Hash
	h.SetSeed(seriesKeySeed)
	h.WriteString(serviceName)
	h.WriteByte(0)
	h.WriteString(metricName)
	h.WriteByte(0)
	if len(attrs) > 0 {
		keys := make([]string, 0, len(attrs))
		for k := range attrs {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			h.WriteString(k)
			h.WriteByte('=')
			writeAttrValue(&h, attrs[k])
			h.WriteByte(0)
		}
	}
	return h.Sum64()
}

// writeAttrValue hashes the canonical bytes of an attribute value without
// allocating an intermediate string for int/float/bool.
func writeAttrValue(h *maphash.Hash, v any) {
	switch x := v.(type) {
	case string:
		h.WriteString(x)
	case bool:
		if x {
			h.WriteString("true")
		} else {
			h.WriteString("false")
		}
	case int64:
		var buf [20]byte
		_, _ = h.Write(strconv.AppendInt(buf[:0], x, 10))
	case int:
		var buf [20]byte
		_, _ = h.Write(strconv.AppendInt(buf[:0], int64(x), 10))
	case float64:
		var buf [32]byte
		_, _ = h.Write(strconv.AppendFloat(buf[:0], x, 'g', -1, 64))
	case nil:
		// nothing to hash
	default:
		_, _ = fmt.Fprintf(h, "%v", x)
	}
}

// numberObserve turns one Sum observation into (per-window delta, running
// total). For cumulative temporality v is the exporter's raw cumulative and
// the delta comes from subtracting the previous observation; the first point
// (and any counter reset where v decreases) returns ok=false so the caller
// can drop it. For delta temporality v is already the per-window delta and
// gets accumulated into the running total; ok is always true.
func (s *seriesStore) numberObserve(key uint64, v float64, cumulative bool, now time.Time) (delta, total float64, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(now)
	entry, exists := s.entries[key]
	if !exists {
		s.admitLocked(key, &seriesState{lastSeen: now, value: v})
		if cumulative {
			return 0, 0, false
		}
		return v, v, true
	}
	entry.lastSeen = now
	if cumulative {
		if v < entry.value {
			entry.value = v
			return 0, 0, false
		}
		delta = v - entry.value
		entry.value = v
		return delta, v, true
	}
	entry.value += v
	return v, entry.value, true
}

// histogramObserve is the distribution counterpart of numberObserve: it
// returns (countDelta, sumDelta, countTotal, sumTotal, ok) with the same
// baseline/reset semantics for cumulative temporality and accumulate-only
// behaviour for delta temporality.
func (s *seriesStore) histogramObserve(key uint64, count uint64, sum float64, cumulative bool, now time.Time) (countDelta uint64, sumDelta, countTotal, sumTotal float64, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(now)
	entry, exists := s.entries[key]
	if !exists {
		s.admitLocked(key, &seriesState{lastSeen: now, count: count, sum: sum})
		if cumulative {
			return 0, 0, 0, 0, false
		}
		return count, sum, float64(count), sum, true
	}
	entry.lastSeen = now
	if cumulative {
		if count < entry.count {
			entry.count = count
			entry.sum = sum
			return 0, 0, 0, 0, false
		}
		countDelta = count - entry.count
		sumDelta = sum - entry.sum
		entry.count = count
		entry.sum = sum
		return countDelta, sumDelta, float64(count), sum, true
	}
	entry.count += count
	entry.sum += sum
	return count, sum, float64(entry.count), entry.sum, true
}

// admitLocked inserts a new entry, evicting the oldest-lastSeen entry when
// the cap is hit. O(N) on eviction but only fires when the map is full, so
// steady-state cost is O(1).
func (s *seriesStore) admitLocked(key uint64, state *seriesState) {
	if s.maxEntries > 0 && len(s.entries) >= s.maxEntries {
		var (
			oldestKey  uint64
			oldestSeen time.Time
			haveOldest bool
		)
		for k, v := range s.entries {
			if !haveOldest || v.lastSeen.Before(oldestSeen) {
				oldestKey = k
				oldestSeen = v.lastSeen
				haveOldest = true
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
