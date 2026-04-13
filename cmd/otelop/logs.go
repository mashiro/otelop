package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/mashiro/otelop/internal/daemon"
)

func logsCommand() *cli.Command {
	return &cli.Command{
		Name:  "logs",
		Usage: "Print the daemon log file",
		Flags: []cli.Flag{
			&cli.BoolFlag{
				Name:    "follow",
				Aliases: []string{"f"},
				Usage:   "stream new log lines as they are written (Ctrl-C to exit)",
			},
		},
		Action: runLogs,
	}
}

func runLogs(_ context.Context, cmd *cli.Command) error {
	path, err := daemon.LogFile()
	if err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			_, _ = fmt.Fprintf(cmd.Writer, "no log file at %s — has otelop been started?\n", path)
			return nil
		}
		return err
	}
	defer func() { _ = f.Close() }()

	if _, err := io.Copy(cmd.Writer, f); err != nil {
		return err
	}
	if !cmd.Bool("follow") {
		return nil
	}

	// Tail mode: re-read whatever the daemon appends until the user sends
	// SIGINT/SIGTERM. The fd is at EOF after the io.Copy above, so the
	// next Read returns only newly-written bytes.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sigCh)
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-sigCh:
			return nil
		case <-ticker.C:
			if _, err := io.Copy(cmd.Writer, f); err != nil {
				return err
			}
		}
	}
}
