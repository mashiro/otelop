package main

import (
	"context"
	"fmt"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/mashiro/otelop/internal/daemon"
)

func stopCommand() *cli.Command {
	return &cli.Command{
		Name:  "stop",
		Usage: "Stop the background otelop server",
		Flags: []cli.Flag{
			&cli.DurationFlag{
				Name:  "timeout",
				Value: 10 * time.Second,
				Usage: "how long to wait for graceful shutdown",
			},
		},
		Action: runStop,
	}
}

func runStop(_ context.Context, cmd *cli.Command) error {
	timeout := cmd.Duration("timeout")

	meta, running, err := daemon.Running()
	if err != nil {
		return err
	}
	if meta == nil {
		_, _ = fmt.Fprintln(cmd.Writer, "otelop is not running (no metadata)")
		return nil
	}
	if !running {
		_, _ = fmt.Fprintf(cmd.Writer, "otelop is not running (stale metadata for pid %d, cleaning up)\n", meta.PID)
		return daemon.RemoveState()
	}

	if err := daemon.StopAndWait(meta.PID, timeout); err != nil {
		return err
	}

	// The daemon child removes its own state on shutdown, but clean up
	// anything left behind if the child was killed uncleanly.
	_ = daemon.RemoveState()
	_, _ = fmt.Fprintf(cmd.Writer, "otelop stopped (pid %d)\n", meta.PID)
	return nil
}
