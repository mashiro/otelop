package storage

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
)

// seedSearchTraces builds five traces exercising every field TracesPage's
// search matches: A has a root span match and a non-root span match, B/C/D
// each isolate one other field (service name, an ILIKE metacharacter, and a
// decoy that must NOT match once "100%" is escaped), and E's only "error"
// hit is a non-root span's Error status code (no name/service of any seeded
// trace contains "error"). All five start at base and are in scope for the
// [from, to) window every case below uses.
func seedSearchTraces(t *testing.T, s *Storage, base time.Time) (a, b, c, d, e [16]byte) {
	t.Helper()
	ctx := context.Background()
	a, b, c, d, e = [16]byte{0xAA, 0x01}, [16]byte{0xBB, 0x02}, [16]byte{0xCC, 0x03}, [16]byte{0xDD, 0x04}, [16]byte{0xEE, 0x05}

	s.AddTraces(ctx, buildTracesMulti(
		spanSpec{
			traceID: a, spanID: [8]byte{1}, name: "checkout.process",
			start: base, end: base.Add(time.Millisecond), service: "checkout-svc",
		},
		spanSpec{
			traceID: a, spanID: [8]byte{2}, parentID: [8]byte{1}, name: "db.query",
			start: base, end: base.Add(time.Millisecond), service: "checkout-svc",
		},
	))
	s.AddTraces(ctx, buildTracesMulti(spanSpec{
		traceID: b, spanID: [8]byte{1}, name: "inventory.sync",
		start: base, end: base.Add(time.Millisecond), service: "inventory-svc",
	}))
	s.AddTraces(ctx, buildTracesMulti(spanSpec{
		traceID: c, spanID: [8]byte{1}, name: "apply 100% discount",
		start: base, end: base.Add(time.Millisecond), service: "billing-svc",
	}))
	s.AddTraces(ctx, buildTracesMulti(spanSpec{
		traceID: d, spanID: [8]byte{1}, name: "apply 100X discount",
		start: base, end: base.Add(time.Millisecond), service: "billing-svc",
	}))
	s.AddTraces(ctx, buildTracesMulti(
		spanSpec{
			traceID: e, spanID: [8]byte{1}, name: "shipment.dispatch",
			start: base, end: base.Add(time.Millisecond), service: "shipping-svc",
		},
		spanSpec{
			traceID: e, spanID: [8]byte{2}, parentID: [8]byte{1}, name: "carrier.call",
			start: base, end: base.Add(time.Millisecond), isError: true, service: "shipping-svc",
		},
	))
	s.Sync()
	return a, b, c, d, e
}

// TestTracesPage_SearchMatchesByField is the table-driven core of issue
// #161's trace search: each case searches for text that should resolve to
// exactly one field on exactly one trace, confirming search matches trace
// ID, ANY span's name (not just the root), any span's status code, and
// resource service name, is case-insensitive, escapes ILIKE metacharacters
// literally, and an empty search is a no-op (matches everything).
func TestTracesPage_SearchMatchesByField(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	a, b, c, d, e := seedSearchTraces(t, s, base)

	idA, idB, idC, idD, idE := pcommon.TraceID(a).String(), pcommon.TraceID(b).String(), pcommon.TraceID(c).String(), pcommon.TraceID(d).String(), pcommon.TraceID(e).String()

	cases := []struct {
		name   string
		search string
		want   []string
	}{
		{"trace ID substring", idA[:4], []string{idA}},
		{"root span name", "checkout.process", []string{idA}},
		{"non-root span name matches too", "db.query", []string{idA}},
		{"case-insensitive", "CHECKOUT.PROCESS", []string{idA}},
		{"service name", "inventory-svc", []string{idB}},
		{"non-root span status code", "error", []string{idE}},
		{"% is escaped, matches only the literal percent", "100%", []string{idC}},
		{"no match", "no-such-trace-anywhere", nil},
		{"empty search matches everything", "", []string{idA, idB, idC, idD, idE}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			items, hasNextPage, err := s.TracesPage(ctx, base.Add(-time.Minute), base.Add(time.Minute), nil, 0, tc.search)
			if err != nil {
				t.Fatalf("TracesPage: %v", err)
			}
			if hasNextPage {
				t.Fatal("hasNextPage = true for an unlimited query")
			}
			got := make([]string, len(items))
			for i, it := range items {
				got[i] = it.TraceID
			}
			if !sameSet(got, tc.want) {
				t.Errorf("trace IDs = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestTracesPage_SearchComposesWithRangeAndPagination confirms search
// narrows the range-filtered set (a search-matching trace outside the time
// window is still excluded) and that pagination/hasNextPage both operate over the
// search-narrowed set, so a match beyond page 1 is reachable via its cursor.
func TestTracesPage_SearchComposesWithRangeAndPagination(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	// Same search term ("worker.task"), one trace outside the queried range.
	for i := 0; i < 3; i++ {
		s.AddTraces(ctx, buildTracesMulti(spanSpec{
			traceID: [16]byte{1, byte(i)}, spanID: [8]byte{byte(i)},
			name: "worker.task", start: base, end: base.Add(time.Millisecond), service: "worker-svc",
		}))
	}
	s.AddTraces(ctx, buildTracesMulti(spanSpec{
		traceID: [16]byte{1, 0xFF}, spanID: [8]byte{0xFF},
		name: "worker.task", start: base.Add(time.Hour), end: base.Add(time.Hour + time.Millisecond), service: "worker-svc",
	}))
	// A non-matching trace inside the range must not affect pagination.
	s.AddTraces(ctx, buildTracesMulti(spanSpec{
		traceID: [16]byte{2}, spanID: [8]byte{1},
		name: "unrelated.op", start: base, end: base.Add(time.Millisecond), service: "other-svc",
	}))
	s.Sync()

	from, to := base.Add(-time.Minute), base.Add(time.Minute)

	all, hasNextPage, err := s.TracesPage(ctx, from, to, nil, 0, "worker.task")
	if err != nil {
		t.Fatalf("TracesPage: %v", err)
	}
	if hasNextPage || len(all) != 3 {
		t.Fatalf("unlimited result: hasNextPage=%v len=%d, want false/3", hasNextPage, len(all))
	}

	page1, hasNextPage, err := s.TracesPage(ctx, from, to, nil, 2, "worker.task")
	if err != nil {
		t.Fatalf("TracesPage page1: %v", err)
	}
	if !hasNextPage || len(page1) != 2 {
		t.Fatalf("page1: hasNextPage=%v len=%d, want true/2", hasNextPage, len(page1))
	}

	last := page1[len(page1)-1]
	after := &TraceCursor{StartTime: last.StartTime, FirstSeen: last.FirstSeen, TraceID: last.TraceID}
	page2, hasNextPage, err := s.TracesPage(ctx, from, to, after, 2, "worker.task")
	if err != nil {
		t.Fatalf("TracesPage page2: %v", err)
	}
	if hasNextPage || len(page2) != 1 {
		t.Fatalf("page2: hasNextPage=%v len=%d, want false/1", hasNextPage, len(page2))
	}
}

// sameSet reports whether got and want contain the same strings, ignoring
// order (TracesPage/LogsPage results are newest-first, not alphabetical).
func sameSet(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	seen := make(map[string]int, len(want))
	for _, w := range want {
		seen[w]++
	}
	for _, g := range got {
		seen[g]--
		if seen[g] < 0 {
			return false
		}
	}
	return true
}
