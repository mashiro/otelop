package main

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/mashiro/otelop/internal/daemon"
)

// The Buffered/Storage rows moved to `otelop info` (see info.go); status now
// only reports process state.
func TestPrintFull_OmitsBufferedAndStorageRows(t *testing.T) {
	meta := &daemon.Metadata{PID: 1234, StartedAt: time.Now()}
	payload := &statusPayload{
		Version:      "v1.2.3",
		StartedAt:    time.Now(),
		HTTPAddr:     ":4319",
		OTLPGrpcAddr: "0.0.0.0:4317",
		OTLPHTTPAddr: "0.0.0.0:4318",
	}
	payload.Config.StoragePath = "/tmp/otelop.duckdb"
	payload.Config.Retention = "7d"
	payload.Config.MaxSize = "4GB"
	payload.Config.TraceCount = 3

	var buf bytes.Buffer
	printFull(&buf, meta, payload)
	out := buf.String()

	if strings.Contains(out, "Buffered") {
		t.Errorf("output still contains a Buffered row:\n%s", out)
	}
	if strings.Contains(out, "Storage") {
		t.Errorf("output still contains a Storage row:\n%s", out)
	}
	if !strings.Contains(out, "v1.2.3") {
		t.Errorf("output missing version:\n%s", out)
	}
	if !strings.Contains(out, "1234") {
		t.Errorf("output missing PID:\n%s", out)
	}
}
