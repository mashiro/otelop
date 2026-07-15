//go:build !windows

package daemon

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

const (
	// readyFD is the file descriptor the child inherits for the ready pipe
	// (passed via ExtraFiles). Stdin/out/err occupy 0-2, so the first
	// ExtraFile lands on 3.
	readyFD = 3

	readyOKLine    = "ok"
	readyErrPrefix = "err:"
)

// Spawn re-execs the current binary as a detached child and blocks until the
// child reports ready (or an error) via an inherited pipe. stdout/stderr of
// the child are redirected to logPath so panics after ready are still
// captured.
//
// Follows the Caddy pattern: one fork, setsid to detach from the terminal,
// and an OS pipe for ready/error synchronisation. The second fork of the
// classical daemon dance is skipped — otelop never opens /dev/tty, so the
// "don't acquire a controlling terminal" guarantee is not needed.
func Spawn(ctx context.Context, logPath string) error {
	// Append rather than truncate: an `otelop logs --follow` running across
	// a `restart` keeps its fd parked at the previous EOF, so a truncate
	// would leave the follower stuck reading EOF until the new run grew
	// past the old size. Unbounded growth is a theoretical concern for a
	// dev tool — handle it externally if it ever bites.
	logFile, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return fmt.Errorf("open daemon log: %w", err)
	}
	defer func() { _ = logFile.Close() }()

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}

	pipeR, pipeW, err := os.Pipe()
	if err != nil {
		return fmt.Errorf("create ready pipe: %w", err)
	}
	defer func() { _ = pipeR.Close() }()

	cmd := exec.CommandContext(ctx, exe, os.Args[1:]...)
	cmd.Env = append(os.Environ(), EnvDaemonized+"="+daemonizedValue)
	cmd.Stdin = nil
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.ExtraFiles = []*os.File{pipeW}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	// CommandContext by default kills the child when ctx is canceled —
	// exactly what we *don't* want for a detached daemon. Disable the kill
	// hook so the daemon can outlive the parent process group.
	cmd.Cancel = func() error { return nil }

	if err := cmd.Start(); err != nil {
		_ = pipeW.Close()
		return fmt.Errorf("start daemon: %w", err)
	}
	// The parent must close its write end, otherwise reads on pipeR will
	// block forever waiting for *someone* to close it even after the child
	// has exited without writing.
	_ = pipeW.Close()

	// Release the child so it truly outlives us (no Wait, no GC of the
	// Process wrapper, no SIGKILL from CommandContext's cleanup).
	if err := cmd.Process.Release(); err != nil {
		return fmt.Errorf("release child: %w", err)
	}

	line, err := bufio.NewReader(pipeR).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("read ready pipe: %w", err)
	}
	line = strings.TrimRight(line, "\n")
	switch {
	case line == readyOKLine:
		return nil
	case strings.HasPrefix(line, readyErrPrefix):
		return errors.New(strings.TrimPrefix(line, readyErrPrefix))
	case line == "":
		return fmt.Errorf("daemon child exited before signalling ready (see %s)", logPath)
	default:
		return fmt.Errorf("unexpected ready-pipe message: %q", line)
	}
}

// ReadyPipe returns the inherited ready pipe when the current process was
// launched via Spawn. Returns nil otherwise — callers can pass the result to
// SignalReady/SignalError unconditionally.
func ReadyPipe() *os.File {
	if !IsDaemonChild() {
		return nil
	}
	return os.NewFile(readyFD, "otelop-ready-pipe")
}

func SignalReady(f *os.File) {
	if f == nil {
		return
	}
	_, _ = f.WriteString(readyOKLine + "\n")
	_ = f.Close()
}

func SignalError(f *os.File, err error) {
	if f == nil || err == nil {
		return
	}
	// Collapse newlines so the parent's ReadString('\n') terminates cleanly.
	msg := strings.ReplaceAll(err.Error(), "\n", " ")
	_, _ = f.WriteString(readyErrPrefix + msg + "\n")
	_ = f.Close()
}

// LockMetadata opens the metadata file and acquires an exclusive advisory
// flock on it. The returned file MUST be held open for the lifetime of the
// daemon — closing it releases the lock and makes the daemon look dead to
// concurrent `otelop status` / `otelop stop` callers. The kernel releases
// the lock automatically when the holding process exits, which is what
// makes the check immune to PID recycling.
func LockMetadata() (*os.File, error) {
	path, err := MetadataFile()
	if err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("lock metadata: %w", err)
	}
	return f, nil
}

// metadataLocked reports whether some other process is currently holding the
// metadata flock. Returns (false, nil) if the metadata file does not exist.
func metadataLocked() (bool, error) {
	path, err := MetadataFile()
	if err != nil {
		return false, err
	}
	f, err := os.OpenFile(path, os.O_RDONLY, 0)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	defer func() { _ = f.Close() }()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		// Any error from a non-blocking LOCK_EX means the lock is held —
		// EWOULDBLOCK in practice, but treat the whole class as "locked".
		return true, nil
	}
	// We acquired the lock, so nobody else was holding it. Release it
	// immediately; the fd close below would do this anyway.
	_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	return false, nil
}

// pollInterval is how often StopAndWait re-checks liveness while waiting for
// a signaled process to exit.
const pollInterval = 50 * time.Millisecond

// StopAndWait sends SIGTERM to the process, then polls until it exits or
// timeout elapses. Returns nil if the process was already gone.
func StopAndWait(pid int, timeout time.Duration) error {
	if pid <= 0 {
		return nil
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		// The Go runtime's os.Process.Signal converts a raw ESRCH from the
		// kill(2) syscall into the sentinel os.ErrProcessDone rather than
		// returning syscall.ESRCH itself (see os.convertESRCH), so checking
		// for syscall.ESRCH alone never matches here — keep both checks for
		// robustness against Go/OS variation.
		if errors.Is(err, os.ErrProcessDone) || errors.Is(err, syscall.ESRCH) {
			return nil
		}
		return err
	}
	alive := func() bool { return ProcessAlive(pid) }
	if waitUntilGone(alive, time.Now, time.Sleep, timeout, pollInterval) {
		return nil
	}
	return fmt.Errorf("process %d did not exit within %s", pid, timeout)
}

// waitUntilGone polls alive until it reports false or the deadline (measured
// from now()) passes, sleeping interval between checks. It returns whether
// the process was observed gone.
//
// The previous implementation raced a ticker channel against a time.After
// deadline channel in a select: whichever channel a stale liveness check
// left "pending" would fire first, but the deadline case returned an error
// immediately with no further liveness check. Because the ticker's next
// tick is, by construction, always later than a deadline that isn't
// perfectly aligned with it, the deadline branch would almost always win
// once a process survived close to the full timeout — even if the process
// had already exited in the (up to pollInterval-wide) gap since the last
// check. Driving the loop off explicit time comparisons instead guarantees
// one final alive() check happens exactly at (or after) the deadline,
// before giving up.
func waitUntilGone(alive func() bool, now func() time.Time, sleep func(time.Duration), timeout, interval time.Duration) bool {
	deadline := now().Add(timeout)
	for {
		if !alive() {
			return true
		}
		if !now().Before(deadline) {
			return false
		}
		sleep(interval)
	}
}
