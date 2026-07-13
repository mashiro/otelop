package exporter

import (
	"context"
	"testing"

	"github.com/mashiro/otelop/internal/selftelemetry"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// fakeSink is a Sink test double so exporter behavior can be verified
// without standing up a real internal/storage.Storage (DuckDB) instance.
type fakeSink struct {
	traces  int
	metrics int
	logs    int
}

func (f *fakeSink) AddTraces(_ context.Context, _ ptrace.Traces)    { f.traces++ }
func (f *fakeSink) AddMetrics(_ context.Context, _ pmetric.Metrics) { f.metrics++ }
func (f *fakeSink) AddLogs(_ context.Context, _ plog.Logs)          { f.logs++ }

func TestExporter_PushTraces_ForwardsToSink(t *testing.T) {
	sink := &fakeSink{}
	e := newExporter(sink)
	if err := e.pushTraces(context.Background(), ptrace.NewTraces()); err != nil {
		t.Fatalf("pushTraces: %v", err)
	}
	if sink.traces != 1 {
		t.Errorf("sink.traces = %d, want 1", sink.traces)
	}
}

func TestExporter_PushMetrics_ForwardsToSink(t *testing.T) {
	sink := &fakeSink{}
	e := newExporter(sink)
	if err := e.pushMetrics(context.Background(), pmetric.NewMetrics()); err != nil {
		t.Fatalf("pushMetrics: %v", err)
	}
	if sink.metrics != 1 {
		t.Errorf("sink.metrics = %d, want 1", sink.metrics)
	}
}

func TestExporter_PushLogs_ForwardsToSink(t *testing.T) {
	sink := &fakeSink{}
	e := newExporter(sink)
	if err := e.pushLogs(context.Background(), plog.NewLogs()); err != nil {
		t.Fatalf("pushLogs: %v", err)
	}
	if sink.logs != 1 {
		t.Errorf("sink.logs = %d, want 1", sink.logs)
	}
}

func TestExporter_InternalTraceBatchDoesNotEmitAnotherSpan(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		_ = provider.Shutdown(context.Background())
	})

	td := ptrace.NewTraces()
	resourceSpans := td.ResourceSpans().AppendEmpty()
	resourceSpans.Resource().Attributes().PutBool(selftelemetry.InternalResourceAttribute, true)
	span := resourceSpans.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	span.SetTraceID(pcommon.TraceID([16]byte{1}))
	span.SetSpanID(pcommon.SpanID([8]byte{1}))

	sink := &fakeSink{}
	if err := newExporter(sink).pushTraces(context.Background(), td); err != nil {
		t.Fatalf("pushTraces: %v", err)
	}
	if got := len(recorder.Ended()); got != 0 {
		t.Fatalf("internal exporter batch emitted %d spans, want none", got)
	}
	if sink.traces != 1 {
		t.Fatalf("internal batch forwards = %d, want 1", sink.traces)
	}
}
