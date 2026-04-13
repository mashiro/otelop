package main

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/mashiro/otelop/internal/daemon"
)

const restartStopTimeout = 10 * time.Second

func restartCommand() *cli.Command {
	cmd := startCommand()
	cmd.Name = "restart"
	cmd.Usage = "Stop the running otelop server and start it again"
	cmd.Action = runRestart
	cmd.Description = "Stops any running otelop daemon and re-runs `start` with the current flags, env vars, and config file values."
	return cmd
}

func runRestart(ctx context.Context, cmd *cli.Command) error {
	// The daemon child re-execs itself with the same argv, so without this
	// guard it would re-enter runRestart, see no running daemon, and call
	// runStart from the wrong layer. Skip the stop in the child and let
	// runStart take the daemon-child path normally.
	if !daemon.IsDaemonChild() {
		if err := stopForRestart(restartStopTimeout, cmd.Writer); err != nil {
			return err
		}
	}
	return runStart(ctx, cmd)
}

// stopForRestart is the quiet variant of stop. It only prints a message when
// it actually terminates a running daemon — stale metadata and "nothing to
// stop" cases are silent so `otelop restart` reads as one operation.
func stopForRestart(timeout time.Duration, w io.Writer) error {
	meta, running, err := daemon.Running()
	if err != nil {
		return err
	}
	if meta == nil {
		return nil
	}
	if !running {
		return daemon.RemoveState()
	}
	if err := daemon.StopAndWait(meta.PID, timeout); err != nil {
		return err
	}
	_ = daemon.RemoveState()
	_, _ = fmt.Fprintf(w, "stopped existing otelop (pid %d)\n", meta.PID)
	return nil
}
