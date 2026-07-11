//go:build !windows

package daemon

import (
	"context"
	"os/exec"
	"testing"
	"time"
)

// TestWaitUntilGone exercises the decision logic StopAndWait relies on,
// with alive()/now()/sleep() faked so the timing behaviour is deterministic
// instead of racing real wall-clock channels.
func TestWaitUntilGone(t *testing.T) {
	t.Run("already gone", func(t *testing.T) {
		sleeps := 0
		sleep := func(time.Duration) { sleeps++ }
		now := func() time.Time { return time.Now() }

		gone := waitUntilGone(func() bool { return false }, now, sleep, time.Second, time.Millisecond)

		if !gone {
			t.Error("waitUntilGone = false, want true when process is already gone")
		}
		if sleeps != 0 {
			t.Errorf("sleep called %d times, want 0 when no polling was needed", sleeps)
		}
	})

	t.Run("polls before succeeding", func(t *testing.T) {
		calls := 0
		alive := func() bool {
			calls++
			return calls <= 2
		}
		sleeps := 0
		sleep := func(time.Duration) { sleeps++ }
		now := func() time.Time { return time.Now() }

		gone := waitUntilGone(alive, now, sleep, time.Second, time.Millisecond)

		if !gone {
			t.Error("waitUntilGone = false, want true once alive() reports false")
		}
		if sleeps != 2 {
			t.Errorf("sleep called %d times, want 2", sleeps)
		}
	})

	t.Run("times out when still alive", func(t *testing.T) {
		clock := time.Now()
		now := func() time.Time { return clock }
		sleep := func(d time.Duration) { clock = clock.Add(d) }

		gone := waitUntilGone(func() bool { return true }, now, sleep, 100*time.Millisecond, 30*time.Millisecond)

		if gone {
			t.Error("waitUntilGone = true, want false when the process never exits")
		}
	})

	// Regression for the race in #163: the process exits during the final
	// poll window, right as the clock reaches the deadline. The old
	// implementation raced a ticker channel against a time.After deadline
	// channel in a select, so a stale liveness check (up to one poll
	// interval old) could lose that race to the deadline and report a
	// timeout even though the process had already exited. waitUntilGone
	// must always perform one more alive() check at the deadline before
	// giving up.
	t.Run("observes exit exactly at the deadline", func(t *testing.T) {
		start := time.Now()
		clock := start
		now := func() time.Time { return clock }
		sleep := func(d time.Duration) { clock = clock.Add(d) }

		timeout := 100 * time.Millisecond
		deadline := start.Add(timeout)
		alive := func() bool { return clock.Before(deadline) }

		gone := waitUntilGone(alive, now, sleep, timeout, 25*time.Millisecond)

		if !gone {
			t.Error("waitUntilGone = false, want true — the deadline-instant check should have observed the process already gone")
		}
	})
}

// TestStopAndWait_SignalsRealProcess is a smoke test for the full StopAndWait
// path against a real subprocess, not just the extracted decision logic.
func TestStopAndWait_SignalsRealProcess(t *testing.T) {
	// context.Background is intentional: cmd.Cancel would otherwise kill
	// this subprocess as soon as the context is done, but nothing here
	// cancels a context — the subprocess's lifetime is controlled entirely
	// by the SIGTERM StopAndWait sends below.
	cmd := exec.CommandContext(context.Background(), "sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start sleep subprocess: %v", err)
	}
	pid := cmd.Process.Pid

	// A real otelop daemon is reparented to init/launchd, which reaps it
	// the instant it exits, so ProcessAlive's kill(pid, 0) probe stops
	// seeing it the moment it's gone. Our subprocess here stays a direct
	// child of this test binary, so without something calling Wait
	// concurrently it would sit as an unreaped zombie — which kill(pid, 0)
	// still reports as present — for as long as the test binary runs,
	// making this test hang/timeout regardless of StopAndWait's own logic.
	// Reaping it in the background as soon as it exits reproduces the
	// prompt-reaper behaviour StopAndWait actually relies on in production.
	waitDone := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(waitDone)
	}()
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		<-waitDone
	})

	if err := StopAndWait(pid, 2*time.Second); err != nil {
		t.Fatalf("StopAndWait: %v", err)
	}
	if ProcessAlive(pid) {
		t.Error("process still alive after StopAndWait returned nil")
	}
}

func TestStopAndWait_AlreadyGone(t *testing.T) {
	// Mirrors TestProcessAlive_Dead's convention: a PID far above what the
	// kernel actually assigns, so signalling it deterministically returns
	// ESRCH without any risk of hitting a real, unrelated process.
	if err := StopAndWait(2147483646, 100*time.Millisecond); err != nil {
		t.Fatalf("StopAndWait on dead pid: %v", err)
	}
}
