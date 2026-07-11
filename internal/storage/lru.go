package storage

import "container/list"

// lruSet is a bounded set of recently-seen keys used purely to skip redundant
// round trips (a known dimension hash, a known (trace_id, span_id) pair). It
// is never consulted for correctness: a miss just takes the slow path (an
// INSERT ... ON CONFLICT DO NOTHING, or — for span dedup — appending a row
// that a QUALIFY row_number() read query would have deduplicated anyway), so
// eviction can never corrupt results, only cost an extra round trip.
type lruSet[K comparable] struct {
	cap   int
	ll    *list.List
	items map[K]*list.Element
}

func newLRUSet[K comparable](capacity int) *lruSet[K] {
	return &lruSet[K]{
		cap:   capacity,
		ll:    list.New(),
		items: make(map[K]*list.Element, capacity),
	}
}

// Contains reports whether key was seen recently, refreshing its recency on
// a hit.
func (c *lruSet[K]) Contains(key K) bool {
	el, ok := c.items[key]
	if !ok {
		return false
	}
	c.ll.MoveToFront(el)
	return true
}

// Add records key as seen, evicting the least-recently-seen key if the
// cache is at capacity.
func (c *lruSet[K]) Add(key K) {
	if el, ok := c.items[key]; ok {
		c.ll.MoveToFront(el)
		return
	}
	el := c.ll.PushFront(key)
	c.items[key] = el
	if c.cap > 0 && c.ll.Len() > c.cap {
		oldest := c.ll.Back()
		if oldest != nil {
			c.ll.Remove(oldest)
			delete(c.items, oldest.Value.(K))
		}
	}
}

// ContainsOrAdd reports whether key was already seen and records it as seen
// either way, in one map lookup instead of a separate Contains+Add pair —
// the span-dedup path (writeTraces) calls this once per span rather than
// probing then inserting.
func (c *lruSet[K]) ContainsOrAdd(key K) bool {
	if el, ok := c.items[key]; ok {
		c.ll.MoveToFront(el)
		return true
	}
	c.Add(key)
	return false
}
