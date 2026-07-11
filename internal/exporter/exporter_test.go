package exporter

import (
	"context"
	"testing"

	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
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
