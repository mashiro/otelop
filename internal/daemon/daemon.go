// Package daemon provides background-process management for `otelop start`:
// a state directory under $XDG_STATE_HOME, a metadata file that doubles as
// the PID anchor, and the Caddy-style re-exec primitive used to spawn a
// detached child while still reporting bind errors back to the parent via a
// synchronisation pipe.
package daemon

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

const (
	// EnvDaemonized marks the child that has been re-exec'd as the
	// detached daemon. Presence of this variable is how the child
	// distinguishes itself from the foreground invocation that spawned it.
	EnvDaemonized = "OTELOP_DAEMONIZED"

	// EnvStateDirOverride lets tests and advanced users point the state
	// directory somewhere other than $XDG_STATE_HOME/otelop.
	EnvStateDirOverride = "OTELOP_STATE_DIR"

	daemonizedValue = "1"

	metadataFilename    = "otelop.json"
	metadataTmpFilename = "otelop.json.tmp"
	logFilename         = "otelop.log"
)

// IsDaemonChild reports whether the current process was launched as the
// detached daemon child of an earlier `otelop start`.
func IsDaemonChild() bool { return os.Getenv(EnvDaemonized) == daemonizedValue }

// StateDir returns the directory used for daemon logs and metadata. It
// honours OTELOP_STATE_DIR and XDG_STATE_HOME, falling back to
// ~/.local/state/otelop on both macOS and Linux for consistency with
// other dev tooling.
func StateDir() (string, error) {
	if dir := os.Getenv(EnvStateDirOverride); dir != "" {
		return dir, nil
	}
	if dir := os.Getenv("XDG_STATE_HOME"); dir != "" {
		return filepath.Join(dir, "otelop"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home dir: %w", err)
	}
	return filepath.Join(home, ".local", "state", "otelop"), nil
}

func EnsureStateDir() (string, error) {
	dir, err := StateDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create state dir: %w", err)
	}
	return dir, nil
}

func LogFile() (string, error) {
	dir, err := StateDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, logFilename), nil
}

func MetadataFile() (string, error) {
	dir, err := StateDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, metadataFilename), nil
}

// Metadata captures the tiny bit of state the parent and sibling invocations
// need without querying the running process. Live counters and uptime are
// intentionally kept out of this file — they come from the GraphQL status
// query so we have a single source of truth.
type Metadata struct {
	PID           int       `json:"pid"`
	StartedAt     time.Time `json:"startedAt"`
	HTTPAddr      string    `json:"httpAddr"`
	OTLPGRPCAddr  string    `json:"otlpGrpcAddr"`
	OTLPHTTPAddr  string    `json:"otlpHttpAddr"`
	ProxyURL      string    `json:"proxyUrl"`
	ProxyProtocol string    `json:"proxyProtocol"`
	Version       string    `json:"version"`
}

// WriteMetadata atomically writes the metadata file via temp + rename so
// concurrent readers never observe a partial write.
func WriteMetadata(meta Metadata) error {
	dir, err := EnsureStateDir()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, metadataTmpFilename)
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, metadataFilename))
}

// ReadMetadata loads the metadata file. It returns (nil, nil) when the file
// does not exist — callers should treat "no metadata" as "not running" rather
// than an error.
func ReadMetadata() (*Metadata, error) {
	path, err := MetadataFile()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var meta Metadata
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, fmt.Errorf("parse metadata %s: %w", path, err)
	}
	return &meta, nil
}

// Running reports whether an otelop daemon is currently active in this
// state directory. It combines ReadMetadata with an advisory flock probe on
// the metadata file, which is immune to PID recycling: the kernel releases
// the lock only when the holding process exits, so `locked == true` always
// means the real daemon is still alive.
//
// Return shapes:
//   - (nil, false, nil): no metadata file — daemon is not running.
//   - (meta, false, nil): metadata exists but no lock holder — the daemon
//     died uncleanly. Callers usually want to clean up the stale file.
//   - (meta, true, nil): daemon is alive and holds the lock. meta.PID is
//     safe to signal.
func Running() (*Metadata, bool, error) {
	meta, err := ReadMetadata()
	if err != nil {
		return nil, false, err
	}
	if meta == nil {
		return nil, false, nil
	}
	locked, err := metadataLocked()
	if err != nil {
		return meta, false, err
	}
	return meta, locked, nil
}

// RemoveState deletes the metadata file. Missing files are not an error.
func RemoveState() error {
	path, err := MetadataFile()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// ProcessAlive reports whether the given PID refers to a live process. It
// uses signal 0 — the kernel returns ESRCH for dead processes and EPERM if
// the process exists but is owned by another user (which we still count as
// alive for our purposes).
func ProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = proc.Signal(syscall.Signal(0))
	if err == nil {
		return true
	}
	return errors.Is(err, syscall.EPERM)
}
