package selftelemetry

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel/attribute"
)

func TestResourceMarksTelemetryAsInternal(t *testing.T) {
	res, err := newResource(context.Background())
	if err != nil {
		t.Fatalf("newResource: %v", err)
	}
	value, ok := res.Set().Value(attribute.Key(InternalResourceAttribute))
	if !ok || !value.AsBool() {
		t.Fatalf("%s = %v, want true", InternalResourceAttribute, value)
	}
}

func TestTracingSuppressionPropagatesThroughContext(t *testing.T) {
	ctx := SuppressTracing(context.Background())
	if !TracingSuppressed(ctx) {
		t.Fatal("TracingSuppressed = false, want true")
	}
}
