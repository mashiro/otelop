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
	cli.VersionPrinter = printVersionWithDocsHint
	if err := newApp(version).Run(context.Background(), os.Args); err != nil {
		slog.Error("fatal", "error", err)
		slog.Info(docsHint)
		os.Exit(1)
	}
}

func newApp(version string) *cli.Command {
	return &cli.Command{
		Name:        "otelop",
		Usage:       "Browser-based OpenTelemetry viewer",
		Version:     version,
		Description: docsHint,
		Commands: []*cli.Command{
			startCommand(version),
			restartCommand(version),
			stopCommand(),
			statusCommand(),
			infoCommand(),
			logsCommand(),
			versionCommand(version),
			docsCommand(),
		},
	}
}

func printVersionWithDocsHint(cmd *cli.Command) {
	_, _ = fmt.Fprintf(cmd.Root().Writer, "%s version %s\n", cmd.Name, cmd.Version)
	_, _ = fmt.Fprintln(cmd.Root().ErrWriter, docsHint)
}
