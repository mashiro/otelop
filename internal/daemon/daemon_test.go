package daemon

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func withStateDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv(EnvStateDirOverride, dir)
	return dir
}

func TestStateDir_OverrideEnv(t *testing.T) {
	t.Setenv(EnvStateDirOverride, "/tmp/explicit")
	got, err := StateDir()
	if err != nil {
		t.Fatalf("StateDir: %v", err)
	}
	if got != "/tmp/explicit" {
		t.Errorf("StateDir = %q, want /tmp/explicit", got)
	}
}

func TestStateDir_XDGFallback(t *testing.T) {
	t.Setenv(EnvStateDirOverride, "")
	t.Setenv("XDG_STATE_HOME", "/tmp/xdg")
	got, err := StateDir()
	if err != nil {
		t.Fatalf("StateDir: %v", err)
	}
	if got != filepath.Join("/tmp/xdg", "otelop") {
		t.Errorf("StateDir = %q, want /tmp/xdg/otelop", got)
	}
}

func TestEnsureStateDir_Creates(t *testing.T) {
	parent := t.TempDir()
	target := filepath.Join(parent, "does", "not", "exist", "otelop")
	t.Setenv(EnvStateDirOverride, target)

	got, err := EnsureStateDir()
	if err != nil {
		t.Fatalf("EnsureStateDir: %v", err)
	}
	if got != target {
		t.Errorf("EnsureStateDir = %q, want %q", got, target)
	}
	if _, err := os.Stat(target); err != nil {
		t.Errorf("directory not created: %v", err)
	}
}

func TestMetadataRoundTrip(t *testing.T) {
	withStateDir(t)
	meta := Metadata{
		PID:          os.Getpid(),
		StartedAt:    time.Date(2026, 4, 13, 10, 0, 0, 0, time.UTC),
		HTTPAddr:     ":4319",
		OTLPGRPCAddr: "0.0.0.0:4317",
		OTLPHTTPAddr: "0.0.0.0:4318",
		Version:      "test",
	}
	if err := WriteMetadata(meta); err != nil {
		t.Fatalf("WriteMetadata: %v", err)
	}

	got, err := ReadMetadata()
	if err != nil {
		t.Fatalf("ReadMetadata: %v", err)
	}
	if got == nil {
		t.Fatal("ReadMetadata returned nil")
	}
	if got.PID != meta.PID || got.HTTPAddr != meta.HTTPAddr || got.Version != meta.Version {
		t.Errorf("roundtrip mismatch: got %+v, want %+v", got, meta)
	}
	if !got.StartedAt.Equal(meta.StartedAt) {
		t.Errorf("StartedAt = %v, want %v", got.StartedAt, meta.StartedAt)
	}
}

func TestReadMetadata_Missing(t *testing.T) {
	withStateDir(t)
	got, err := ReadMetadata()
	if err != nil {
		t.Fatalf("ReadMetadata: %v", err)
	}
	if got != nil {
		t.Errorf("ReadMetadata = %+v, want nil for missing file", got)
	}
}

func TestRemoveState(t *testing.T) {
	withStateDir(t)
	meta := Metadata{PID: 12345, StartedAt: time.Now(), HTTPAddr: ":4319"}
	if err := WriteMetadata(meta); err != nil {
		t.Fatalf("WriteMetadata: %v", err)
	}
	if err := RemoveState(); err != nil {
		t.Fatalf("RemoveState: %v", err)
	}
	got, err := ReadMetadata()
	if err != nil {
		t.Fatalf("ReadMetadata after remove: %v", err)
	}
	if got != nil {
		t.Errorf("metadata still present after RemoveState: %+v", got)
	}

	// RemoveState should be idempotent — a second call on a clean state
	// must not return an error.
	if err := RemoveState(); err != nil {
		t.Errorf("RemoveState second call: %v", err)
	}
}

func TestProcessAlive_Self(t *testing.T) {
	if !ProcessAlive(os.Getpid()) {
		t.Error("ProcessAlive(self) = false, want true")
	}
}

func TestProcessAlive_Dead(t *testing.T) {
	// PID 1 always exists on Unix-like systems but may be unowned. Pick a
	// PID that is extremely unlikely to be in use: the max int32 value.
	// The kernel caps PIDs well below this so signalling it returns ESRCH.
	if ProcessAlive(2147483646) {
		t.Error("ProcessAlive(garbage pid) = true, want false")
	}
	if ProcessAlive(0) {
		t.Error("ProcessAlive(0) = true, want false")
	}
	if ProcessAlive(-1) {
		t.Error("ProcessAlive(-1) = true, want false")
	}
}

func TestIsDaemonChild(t *testing.T) {
	t.Setenv(EnvDaemonized, "")
	if IsDaemonChild() {
		t.Error("IsDaemonChild() = true with empty env")
	}
	t.Setenv(EnvDaemonized, "1")
	if !IsDaemonChild() {
		t.Error("IsDaemonChild() = false with env=1")
	}
}

func TestRunning_NoMetadata(t *testing.T) {
	withStateDir(t)
	meta, running, err := Running()
	if err != nil {
		t.Fatalf("Running: %v", err)
	}
	if meta != nil || running {
		t.Errorf("Running() = (%+v, %v), want (nil, false)", meta, running)
	}
}

func TestRunning_StaleMetadata(t *testing.T) {
	// Metadata exists but no live daemon holds the flock — Running should
	// report meta != nil and running == false so callers can clean up.
	withStateDir(t)
	if err := WriteMetadata(Metadata{PID: os.Getpid(), HTTPAddr: ":4319"}); err != nil {
		t.Fatalf("WriteMetadata: %v", err)
	}
	meta, running, err := Running()
	if err != nil {
		t.Fatalf("Running: %v", err)
	}
	if meta == nil {
		t.Fatal("Running returned nil metadata for present file")
	}
	if running {
		t.Errorf("Running() = true with no flock holder, want false")
	}
}

func TestRunning_LockedMetadata(t *testing.T) {
	withStateDir(t)
	if err := WriteMetadata(Metadata{PID: os.Getpid(), HTTPAddr: ":4319"}); err != nil {
		t.Fatalf("WriteMetadata: %v", err)
	}
	lockFile, err := LockMetadata()
	if err != nil {
		t.Fatalf("LockMetadata: %v", err)
	}
	defer func() { _ = lockFile.Close() }()

	meta, running, err := Running()
	if err != nil {
		t.Fatalf("Running: %v", err)
	}
	if meta == nil || !running {
		t.Errorf("Running() = (%+v, %v), want (meta, true)", meta, running)
	}

	// Closing the lock file releases the flock — subsequent Running calls
	// should drop back to the stale state without any process needing to die.
	_ = lockFile.Close()
	if _, running, err := Running(); err != nil {
		t.Fatalf("Running after close: %v", err)
	} else if running {
		t.Errorf("Running() = true after lock released, want false")
	}
}

func TestLockMetadata_DoubleAcquireFails(t *testing.T) {
	withStateDir(t)
	if err := WriteMetadata(Metadata{PID: os.Getpid()}); err != nil {
		t.Fatalf("WriteMetadata: %v", err)
	}
	first, err := LockMetadata()
	if err != nil {
		t.Fatalf("LockMetadata: %v", err)
	}
	defer func() { _ = first.Close() }()

	// flock is per-open-file-description, so a second OpenFile + Flock from
	// the same process should still see the lock as held.
	if second, err := LockMetadata(); err == nil {
		_ = second.Close()
		t.Error("LockMetadata returned nil error on second acquire, want lock-held error")
	}
}
