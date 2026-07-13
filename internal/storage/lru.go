package storage

import "container/list"

// lruSet is a bounded set of recently-seen dimension keys used purely to skip
// redundant idempotent upserts. Eviction only costs an extra round trip.
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
