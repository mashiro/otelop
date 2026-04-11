package store

import (
	"reflect"
	"testing"
)

func TestRingBuffer_Add_ReturnsEvicted(t *testing.T) {
	rb := NewRingBuffer[string](2)

	_, _, evicted := rb.Add("a")
	if evicted {
		t.Errorf("initial Add should not evict")
	}
	_, _, evicted = rb.Add("b")
	if evicted {
		t.Errorf("second Add should not evict")
	}
	_, ev, wasEv := rb.Add("c") // should evict "a"
	if !wasEv {
		t.Fatal("third Add should evict")
	}
	if ev != "a" {
		t.Errorf("evicted = %q, want a", ev)
	}

	_, ev, wasEv = rb.Add("d") // should evict "b"
	if !wasEv || ev != "b" {
		t.Errorf("fourth Add: evicted=%q wasEv=%v, want b/true", ev, wasEv)
	}

	items := rb.Items()
	if !reflect.DeepEqual(items, []string{"c", "d"}) {
		t.Errorf("items = %v, want [c d]", items)
	}
}

func TestRingBuffer_Page(t *testing.T) {
	rb := NewRingBuffer[int](5)
	for i := 1; i <= 5; i++ {
		rb.Add(i)
	}

	tests := []struct {
		name      string
		offset    int
		limit     int
		wantItems []int
		wantTotal int
	}{
		{"all newest first", 0, 0, []int{5, 4, 3, 2, 1}, 5},
		{"limit 2 from newest", 0, 2, []int{5, 4}, 5},
		{"offset 2 limit 2", 2, 2, []int{3, 2}, 5},
		{"offset past end", 10, 5, nil, 5},
		{"offset 4 limit 10", 4, 10, []int{1}, 5},
		{"negative offset treated as 0", -5, 1, []int{5}, 5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			items, total := rb.Page(tt.offset, tt.limit)
			if !reflect.DeepEqual(items, tt.wantItems) {
				t.Errorf("items = %v, want %v", items, tt.wantItems)
			}
			if total != tt.wantTotal {
				t.Errorf("total = %d, want %d", total, tt.wantTotal)
			}
		})
	}
}

func TestRingBuffer_Page_AfterWrap(t *testing.T) {
	rb := NewRingBuffer[int](3)
	// Insert 1..5, wrapping so buffer holds [3, 4, 5] (oldest first).
	for i := 1; i <= 5; i++ {
		rb.Add(i)
	}

	items, total := rb.Page(0, 0)
	if total != 3 {
		t.Errorf("total = %d, want 3", total)
	}
	// newest-first = [5, 4, 3]
	if !reflect.DeepEqual(items, []int{5, 4, 3}) {
		t.Errorf("items = %v, want [5 4 3]", items)
	}

	items, _ = rb.Page(1, 1)
	if !reflect.DeepEqual(items, []int{4}) {
		t.Errorf("page(1,1) = %v, want [4]", items)
	}
}

func TestRingBuffer_Page_Empty(t *testing.T) {
	rb := NewRingBuffer[int](3)
	items, total := rb.Page(0, 10)
	if total != 0 {
		t.Errorf("total = %d, want 0", total)
	}
	if items != nil {
		t.Errorf("items = %v, want nil", items)
	}
}

func TestStore_TraceIndex_SurvivesEviction(t *testing.T) {
	s := NewStore(2, 2, 2, 100, nil)

	// Add 3 traces into a cap=2 buffer. The first should be evicted.
	for i := 1; i <= 3; i++ {
		s.mu.Lock()
		trace := &TraceData{TraceID: string(rune('a' + i - 1))}
		idx, evicted, wasEv := s.traces.Add(trace)
		if wasEv && evicted != nil {
			delete(s.traceIndex, evicted.TraceID)
		}
		s.traceIndex[trace.TraceID] = idx
		s.mu.Unlock()
	}

	if _, ok := s.traceIndex["a"]; ok {
		t.Error("evicted trace 'a' should be removed from index")
	}
	if _, ok := s.traceIndex["b"]; !ok {
		t.Error("trace 'b' should remain in index")
	}
	if _, ok := s.traceIndex["c"]; !ok {
		t.Error("trace 'c' should be in index")
	}
}
