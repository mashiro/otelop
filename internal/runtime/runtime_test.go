package runtime

import (
	"bytes"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestWatchCollectorErrorsCancelsOnFailure(t *testing.T) {
	ch := make(chan error, 1)
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	canceled := make(chan struct{})
	cancel := func() { close(canceled) }

	ch <- errors.New("boom")
	close(ch)

	done := make(chan struct{})
	go func() {
		watchCollectorErrors(ch, cancel, logger)
		close(done)
	}()

	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("cancel was not called after a collector error")
	}
	<-done
	if !strings.Contains(buf.String(), "boom") {
		t.Errorf("log output = %q, want it to mention the collector error", buf.String())
	}
}

func TestWatchCollectorErrorsNoOpOnCleanShutdown(t *testing.T) {
	ch := make(chan error)
	close(ch)
	canceled := false

	done := make(chan struct{})
	go func() {
		watchCollectorErrors(ch, func() { canceled = true }, slog.Default())
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("watchCollectorErrors did not return on channel close")
	}
	if canceled {
		t.Error("cancel was called on a clean collector shutdown")
	}
}
