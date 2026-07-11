package storage

import "testing"

func TestHashResource_InsertionOrderIndependent(t *testing.T) {
	a := map[string]any{"service.name": "svc", "region": "us-east-1", "count": int64(3)}
	b := map[string]any{"count": int64(3), "region": "us-east-1", "service.name": "svc"}

	if hashResource(a) != hashResource(b) {
		t.Fatalf("hashResource depends on map iteration order: %d != %d", hashResource(a), hashResource(b))
	}
}

func TestHashResource_DifferentAttrsDiffer(t *testing.T) {
	a := map[string]any{"service.name": "svc-a"}
	b := map[string]any{"service.name": "svc-b"}

	if hashResource(a) == hashResource(b) {
		t.Fatalf("expected different attrs to hash differently, both got %d", hashResource(a))
	}
}

func TestHashResource_StableAcrossProcesses(t *testing.T) {
	// This pins the exact hash the current implementation produces. It is
	// the difference that matters most vs. the old store package seriesKey
	// (hash/maphash with a process-local seed): resource_hash is a DuckDB
	// primary key that must resolve to the same row after a restart, so the
	// function must not depend on any per-process seed. If this test ever
	// needs to change, the storage schema needs a migration, since existing
	// databases would otherwise silently stop matching their own rows.
	attrs := map[string]any{"service.name": "svc", "region": "us-east-1"}
	const want = uint64(0x41f6060425c2787d)
	if got := hashResource(attrs); got != want {
		t.Fatalf("hashResource(%v) = %#x, want %#x (did the canonical encoding change?)", attrs, got, want)
	}
}

func TestHashSeries_InsertionOrderIndependent(t *testing.T) {
	a := map[string]any{"http.method": "GET", "http.status_code": int64(200)}
	b := map[string]any{"http.status_code": int64(200), "http.method": "GET"}

	ka := hashSeries("svc", "http.server.duration", a)
	kb := hashSeries("svc", "http.server.duration", b)
	if ka != kb {
		t.Fatalf("hashSeries depends on map iteration order: %d != %d", ka, kb)
	}
}

func TestHashSeries_DifferentServiceOrMetricNameDiffer(t *testing.T) {
	attrs := map[string]any{"http.method": "GET"}
	base := hashSeries("svc-a", "metric", attrs)

	if hashSeries("svc-b", "metric", attrs) == base {
		t.Fatal("expected different service name to change the series key")
	}
	if hashSeries("svc-a", "other-metric", attrs) == base {
		t.Fatal("expected different metric name to change the series key")
	}
}

func TestHashResource_ValueTypesDistinguished(t *testing.T) {
	// A naive encoding (e.g. fmt.Sprintf("%v", ...) per value) would hash the
	// string "3" and the int64 3 identically. Guard against that regression.
	strAttrs := map[string]any{"k": "3"}
	intAttrs := map[string]any{"k": int64(3)}
	if hashResource(strAttrs) == hashResource(intAttrs) {
		t.Fatal("expected string \"3\" and int64 3 to hash differently")
	}
}

func TestHashResource_NestedValues(t *testing.T) {
	nested := map[string]any{
		"tags": []any{"a", "b"},
		"meta": map[string]any{"x": int64(1)},
	}
	reordered := map[string]any{
		"meta": map[string]any{"x": int64(1)},
		"tags": []any{"a", "b"},
	}
	if hashResource(nested) != hashResource(reordered) {
		t.Fatal("expected nested slice/map values to hash independent of top-level key order")
	}
}
