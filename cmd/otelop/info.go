package main

import (
	"context"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/urfave/cli/v3"

	"github.com/mashiro/otelop/internal/config"
	otelruntime "github.com/mashiro/otelop/internal/runtime"
)

func infoCommand(version string) *cli.Command {
	cfg, cfgPath, cfgErr := config.Load()

	return &cli.Command{
		Name:   "info",
		Usage:  "Show resolved configuration",
		Before: configLoadErrorBefore(cfgErr),
		// Shares start's flag set so a flag/env var override shown here is
		// guaranteed to match what `otelop start` would actually resolve.
		Flags: configFlags(cfg),
		Action: func(_ context.Context, cmd *cli.Command) error {
			opts := runtimeOptionsFromCmd(cmd, cfg, version)
			if err := otelruntime.Validate(opts); err != nil {
				return err
			}
			return printInfoResolved(cmd.Writer, cfgPath, opts)
		},
		Description: configDescription(cfgPath),
	}
}

// printInfoResolved renders the configuration resolved from CLI flags,
// environment variables, the TOML file, and built-in defaults — the same
// precedence `otelop start` applies. It deliberately does not inspect a
// running instance or the database; runtime information belongs to `otelop
// status`.
func printInfoResolved(w io.Writer, cfgPath string, opts otelruntime.Options) error {
	cfgDisplay := cfgPath
	if !fileExists(cfgPath) {
		cfgDisplay = cfgPath + " (not found)"
	}

	storagePath, err := otelruntime.ResolveStoragePath(opts.StoragePath)
	if err != nil {
		return err
	}

	rows := bannerRows{
		{"Config file", cfgDisplay},
		{"Web UI", "http://" + webUIDisplay(opts.HTTPAddr)},
		{"OTLP gRPC", opts.OTLPGRPCAddr},
		{"OTLP HTTP", opts.OTLPHTTPAddr},
	}
	summaries := exporterSummaries(opts.Exporters)
	rows = append(rows, exporterRowsWith(len(summaries), "(none)", func(i int) string {
		return formatExporter(summaries[i]) + formatExporterOptions(opts.Exporters[i])
	})...)
	rows = append(rows, bannerRows{
		{"Log level", opts.LogLevel},
		{"Debug", strconv.FormatBool(opts.Debug)},
		{"Render window max", strconv.Itoa(opts.RenderWindowMax)},
		{"Storage path", storagePath},
		{"Retention", opts.Retention},
		{"Max size", opts.MaxSize},
		{"Memory limit", opts.MemoryLimit},
	}...)
	writeBanner(w, " info — configuration", rows)
	return nil
}

// formatExporterOptions lists the per-exporter settings that differ from
// forwarding as received, e.g. " (metrics=delta, batch=on)".
func formatExporterOptions(e otelruntime.ExporterOptions) string {
	var parts []string
	if e.MetricsTemporality != "" {
		parts = append(parts, "metrics="+e.MetricsTemporality)
	}
	if e.Batch.Enabled {
		parts = append(parts, "batch=on")
	}
	if len(parts) == 0 {
		return ""
	}
	return " (" + strings.Join(parts, ", ") + ")"
}

// fileExists reports whether path exists, folding away os.Stat's error
// (permission errors included — this is cosmetic display, not a correctness
// check) so callers don't shadow an unrelated `err` in scope.
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
