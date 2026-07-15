package storage

import (
	"testing"

	"go.opentelemetry.io/collector/pdata/pcommon"
)

func testEncodedAttrs(t *testing.T, values map[string]any) []byte {
	t.Helper()
	attrs := pcommon.NewMap()
	if err := attrs.FromRaw(values); err != nil {
		t.Fatal(err)
	}
	return encodeOTLPAttributes(attrs)
}

func TestHashResource_InsertionOrderIndependent(t *testing.T) {
	a := map[string]any{"service.name": "svc", "region": "us-east-1", "count": int64(3)}
	b := map[string]any{"count": int64(3), "region": "us-east-1", "service.name": "svc"}

	if hashResource("", 0, testEncodedAttrs(t, a)) != hashResource("", 0, testEncodedAttrs(t, b)) {
		t.Fatal("hashResource depends on attribute insertion order")
	}
}

func TestHashResource_DifferentAttrsDiffer(t *testing.T) {
	a := map[string]any{"service.name": "svc-a"}
	b := map[string]any{"service.name": "svc-b"}

	if hashResource("", 0, testEncodedAttrs(t, a)) == hashResource("", 0, testEncodedAttrs(t, b)) {
		t.Fatal("expected different attrs to hash differently")
	}
}

func TestHashResource_DifferentSchemaURLDiffers(t *testing.T) {
	attrs := map[string]any{"service.name": "svc"}
	raw := testEncodedAttrs(t, attrs)
	if hashResource("schema-a", 0, raw) == hashResource("schema-b", 0, raw) {
		t.Fatal("expected resource schema URL to participate in resource identity")
	}
}

func TestHashResource_DifferentDroppedAttributeCountDiffers(t *testing.T) {
	attrs := map[string]any{"service.name": "svc"}
	raw := testEncodedAttrs(t, attrs)
	if hashResource("", 1, raw) == hashResource("", 2, raw) {
		t.Fatal("expected dropped attribute count to participate in resource identity")
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
	const want = uint64(0xc857d69fffaf294b)
	if got := hashResource("", 0, testEncodedAttrs(t, attrs)); got != want {
		t.Fatalf("hashResource(%v) = %#x, want %#x (did the canonical encoding change?)", attrs, got, want)
	}
}

func TestHashSeries_InsertionOrderIndependent(t *testing.T) {
	a := map[string]any{"http.method": "GET", "http.status_code": int64(200)}
	b := map[string]any{"http.status_code": int64(200), "http.method": "GET"}

	identity := metricSeriesIdentity{
		ResourceHash:  1,
		Scope:         metricScopeIdentity{Name: "scope", Version: "1.0"},
		MetricName:    "http.server.duration",
		AttributesRaw: testEncodedAttrs(t, a),
	}
	ka := hashSeries(identity)
	identity.AttributesRaw = testEncodedAttrs(t, b)
	kb := hashSeries(identity)
	if ka != kb {
		t.Fatalf("hashSeries depends on map iteration order: %d != %d", ka, kb)
	}
}

func TestHashSeries_DifferentResourceScopeOrMetricNameDiffer(t *testing.T) {
	attrs := map[string]any{"http.method": "GET"}
	identity := metricSeriesIdentity{
		ResourceHash:  1,
		Scope:         metricScopeIdentity{SchemaURL: "schema", Name: "scope", Version: "1.0"},
		MetricName:    "metric",
		AttributesRaw: testEncodedAttrs(t, attrs),
	}
	base := hashSeries(identity)

	identity.ResourceHash = 2
	if hashSeries(identity) == base {
		t.Fatal("expected different resource to change the series key")
	}
	identity.ResourceHash = 1
	identity.Scope.Name = "other-scope"
	if hashSeries(identity) == base {
		t.Fatal("expected different scope name to change the series key")
	}
	identity.Scope.Name = "scope"
	identity.MetricName = "other-metric"
	if hashSeries(identity) == base {
		t.Fatal("expected different metric name to change the series key")
	}
}

func TestHashSeries_DifferentMetricDescriptorDiffers(t *testing.T) {
	identity := metricSeriesIdentity{
		ResourceHash: 1,
		Scope:        metricScopeIdentity{Name: "scope"},
		MetricName:   "requests",
		MetricType:   "Sum",
		NumberKind:   "int",
		Unit:         "{request}",
		Temporality:  "cumulative",
		IsMonotonic:  true,
	}
	base := hashSeries(identity)
	variants := []metricSeriesIdentity{
		func() metricSeriesIdentity { v := identity; v.MetricType = "Gauge"; return v }(),
		func() metricSeriesIdentity { v := identity; v.NumberKind = "double"; return v }(),
		func() metricSeriesIdentity { v := identity; v.Unit = "1"; return v }(),
		func() metricSeriesIdentity { v := identity; v.Temporality = "delta"; return v }(),
		func() metricSeriesIdentity { v := identity; v.IsMonotonic = false; return v }(),
	}
	for _, variant := range variants {
		if hashSeries(variant) == base {
			t.Fatalf("descriptor variant did not change series key: %+v", variant)
		}
	}
}

func TestHashResource_ValueTypesDistinguished(t *testing.T) {
	// A naive encoding (e.g. fmt.Sprintf("%v", ...) per value) would hash the
	// string "3" and the int64 3 identically. Guard against that regression.
	strAttrs := map[string]any{"k": "3"}
	intAttrs := map[string]any{"k": int64(3)}
	if hashResource("", 0, testEncodedAttrs(t, strAttrs)) == hashResource("", 0, testEncodedAttrs(t, intAttrs)) {
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
	if hashResource("", 0, testEncodedAttrs(t, nested)) != hashResource("", 0, testEncodedAttrs(t, reordered)) {
		t.Fatal("expected nested slice/map values to hash independent of top-level key order")
	}
}
