//go:build windows

package daemon

import (
	"context"
	"errors"
	"os"
	"time"
)

// Spawn is unsupported on Windows — `otelop start` requires --foreground
// there. A future Windows service wrapper (or `otelop install-service`) can
// fill this in.
func Spawn(_ context.Context, _ string) error {
	return errors.New("daemon mode is not supported on Windows — use `otelop start --foreground`")
}

func ReadyPipe() *os.File             { return nil }
func SignalReady(_ *os.File)          {}
func SignalError(_ *os.File, _ error) {}

func LockMetadata() (*os.File, error) {
	return nil, errors.New("daemon mode is not supported on Windows")
}

func metadataLocked() (bool, error) { return false, nil }

func StopAndWait(_ int, _ time.Duration) error {
	return errors.New("stop is not supported on Windows")
}
