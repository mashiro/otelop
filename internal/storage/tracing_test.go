package storage

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestStorageTracingPropagatesAcrossAsyncPipeline(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(context.Background())
	})

	s := openTestStorage(t, Options{OnCommit: func(context.Context, CommitEvent) {}})
	s.AddLogs(context.Background(), buildLog([16]byte{1}, "traced", "svc", time.Now()))
	s.Sync()

	want := map[string]bool{
		"storage.AddLogs":         false,
		"storage.ConvertLogs":     false,
		"storage.queue.wait":      false,
		"storage.writeLogs":       false,
		"storage.upsertResources": false,
		"storage.appendLogs":      false,
		"storage.deliverCommit":   false,
	}
	var traceID string
	var commitQueueWaitSeen bool
	for _, span := range recorder.Ended() {
		if _, ok := want[span.Name()]; !ok {
			continue
		}
		want[span.Name()] = true
		gotTraceID := span.SpanContext().TraceID().String()
		if traceID == "" {
			traceID = gotTraceID
		} else if gotTraceID != traceID {
			t.Errorf("span %s trace ID = %s, want %s", span.Name(), gotTraceID, traceID)
		}
		if span.Name() == "storage.deliverCommit" {
			for _, attr := range span.Attributes() {
				if string(attr.Key) == "storage.queue.wait_ms" {
					commitQueueWaitSeen = true
				}
			}
		}
	}
	for name, seen := range want {
		if !seen {
			t.Errorf("missing span %q; ended spans: %v", name, spanNames(recorder.Ended()))
		}
	}
	if !commitQueueWaitSeen {
		t.Error("storage.deliverCommit missing storage.queue.wait_ms")
	}
}

func TestStorageAsyncWriteOutlivesCallerContext(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx, cancel := context.WithCancel(context.Background())
	s.AddLogs(ctx, buildLog([16]byte{2}, "after cancel", "svc", time.Now()))
	cancel()
	s.Sync()

	var count int
	if err := s.DB().QueryRowContext(context.Background(), `SELECT count(*) FROM logs WHERE body = 'after cancel'`).Scan(&count); err != nil {
		t.Fatalf("count logs: %v", err)
	}
	if count != 1 {
		t.Fatalf("logs after caller cancellation = %d, want 1", count)
	}
}

func spanNames(spans []sdktrace.ReadOnlySpan) []string {
	names := make([]string, len(spans))
	for i, span := range spans {
		names[i] = span.Name()
	}
	return names
}
