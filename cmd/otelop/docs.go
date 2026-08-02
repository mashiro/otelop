package main

import (
	"context"
	"encoding/json"
	"fmt"
	"text/tabwriter"

	"github.com/urfave/cli/v3"

	otelopdocs "github.com/mashiro/otelop/docs"
)

func docsCommand() *cli.Command {
	return &cli.Command{
		Name:  "docs",
		Usage: "Read documentation bundled with this version of otelop",
		Commands: []*cli.Command{
			{
				Name:  "list",
				Usage: "List available documentation",
				Flags: []cli.Flag{
					&cli.BoolFlag{
						Name:  "json",
						Usage: "print machine-readable JSON",
					},
				},
				Action: runDocsList,
			},
			{
				Name:      "show",
				Usage:     "Print a document as Markdown",
				Arguments: []cli.Argument{&cli.StringArg{Name: "name"}},
				Action:    runDocsShow,
			},
		},
	}
}

func runDocsList(_ context.Context, cmd *cli.Command) error {
	if cmd.NArg() != 0 {
		return fmt.Errorf("docs list accepts no arguments")
	}
	documents, err := otelopdocs.List()
	if err != nil {
		return err
	}
	if !cmd.Bool("json") {
		writer := tabwriter.NewWriter(cmd.Writer, 0, 4, 2, ' ', 0)
		for _, document := range documents {
			if _, err := fmt.Fprintf(writer, "%s\t%s\n", document.Name, document.Description); err != nil {
				return err
			}
		}
		return writer.Flush()
	}
	encoder := json.NewEncoder(cmd.Writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(documents)
}

func runDocsShow(_ context.Context, cmd *cli.Command) error {
	name := cmd.StringArg("name")
	if name == "" {
		return fmt.Errorf("document name is required; run `otelop docs list` to list available documents")
	}
	if cmd.NArg() != 0 {
		return fmt.Errorf("docs show accepts exactly one document name")
	}
	body, err := otelopdocs.Show(name)
	if err != nil {
		return fmt.Errorf("%w; run `otelop docs list` to list available documents", err)
	}
	_, err = fmt.Fprint(cmd.Writer, body)
	return err
}
