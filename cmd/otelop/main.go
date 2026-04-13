package main

import (
	"context"
	"fmt"
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
			startCommand(),
			stopCommand(),
			statusCommand(),
			{
				Name:  "version",
				Usage: "Print version",
				Action: func(_ context.Context, _ *cli.Command) error {
					fmt.Println(version)
					return nil
				},
			},
		},
	}

	if err := app.Run(context.Background(), os.Args); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}
