package main

import (
	"context"
	"fmt"

	"github.com/urfave/cli/v3"
)

func versionCommand(version string) *cli.Command {
	return &cli.Command{
		Name:  "version",
		Usage: "Print version",
		Action: func(_ context.Context, cmd *cli.Command) error {
			_, err := fmt.Fprintln(cmd.Writer, version)
			return err
		},
	}
}
