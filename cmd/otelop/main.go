package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/urfave/cli/v3"
)

var version = "dev"

func main() {
	app := &cli.Command{
		Name:    "otelop",
		Usage:   "Browser-based OpenTelemetry viewer",
		Version: version,
		Commands: []*cli.Command{
			startCommand(version),
			restartCommand(version),
			stopCommand(),
			statusCommand(),
			infoCommand(),
			logsCommand(),
			versionCommand(version),
		},
	}

	if err := app.Run(context.Background(), os.Args); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}
