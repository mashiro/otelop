package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/urfave/cli/v3"

	"github.com/mashiro/otelop/internal/config"
	otelruntime "github.com/mashiro/otelop/internal/runtime"
)

func serverFlags(cfg config.Config) []cli.Flag {
	return append([]cli.Flag{
		&cli.BoolFlag{Name: "foreground", Aliases: []string{"f"}, Usage: "run in the foreground instead of detaching"},
	}, configFlags(cfg)...)
}

// configFlags keeps start, restart, and info consistent about how a config
// value resolves across CLI flag > env var > config file > default.
func configFlags(cfg config.Config) []cli.Flag {
	return []cli.Flag{
		&cli.StringFlag{Name: "http", Value: cfg.HTTPAddr, Usage: "Web UI + REST API listen address", Sources: cli.EnvVars("OTELOP_HTTP")},
		&cli.StringFlag{Name: "otlp-grpc", Value: cfg.OTLPGRPCAddr, Usage: "OTLP gRPC receiver endpoint", Sources: cli.EnvVars("OTELOP_OTLP_GRPC")},
		&cli.StringFlag{Name: "otlp-http", Value: cfg.OTLPHTTPAddr, Usage: "OTLP HTTP receiver endpoint", Sources: cli.EnvVars("OTELOP_OTLP_HTTP")},
		&cli.StringFlag{Name: "storage-path", Value: cfg.Storage.Path, Usage: "DuckDB database file path (empty = XDG default)", Sources: cli.EnvVars("OTELOP_STORAGE_PATH")},
		&cli.StringFlag{Name: "storage-retention", Value: cfg.Storage.Retention, Usage: "how long to keep telemetry (e.g. 7d, 168h)", Sources: cli.EnvVars("OTELOP_STORAGE_RETENTION")},
		&cli.StringFlag{Name: "storage-max-size", Value: cfg.Storage.MaxSize, Usage: "stored data size ceiling; the oldest days are trimmed above it (e.g. 4GB, 4GiB)", Sources: cli.EnvVars("OTELOP_STORAGE_MAX_SIZE")},
		&cli.StringFlag{Name: "storage-memory-limit", Value: cfg.Storage.MemoryLimit, Usage: "DuckDB memory ceiling (e.g. 512MB, 1GiB)", Sources: cli.EnvVars("OTELOP_STORAGE_MEMORY_LIMIT")},
		&cli.IntFlag{Name: "ui-render-window-max", Value: cfg.UI.RenderWindowMax, Usage: "max rows the traces/metrics/logs tables render at once", Sources: cli.EnvVars("OTELOP_UI_RENDER_WINDOW_MAX")},
		&cli.StringFlag{Name: "log-level", Value: cfg.LogLevel, Usage: "log level (debug|info|warn|error)", Sources: cli.EnvVars("OTELOP_LOG_LEVEL")},
		&cli.BoolFlag{Name: "debug", Value: cfg.Debug, Usage: "export otelop's own telemetry to itself", Sources: cli.EnvVars("OTELOP_DEBUG")},
	}
}

// runtimeOptionsFromCmd reads the flags configFlags defines off an already
// parsed command into otelruntime.Options. Exporters come straight from the
// config file because they have no flag/env surface.
func runtimeOptionsFromCmd(cmd *cli.Command, cfg config.Config, version string) otelruntime.Options {
	return otelruntime.Options{
		Version:         version,
		HTTPAddr:        cmd.String("http"),
		OTLPGRPCAddr:    cmd.String("otlp-grpc"),
		OTLPHTTPAddr:    cmd.String("otlp-http"),
		Exporters:       otelruntime.ExportersFromConfig(cfg.Exporters),
		StoragePath:     strings.TrimSpace(cmd.String("storage-path")),
		Retention:       cmd.String("storage-retention"),
		MaxSize:         cmd.String("storage-max-size"),
		MemoryLimit:     cmd.String("storage-memory-limit"),
		RenderWindowMax: cmd.Int("ui-render-window-max"),
		LogLevel:        cmd.String("log-level"),
		Debug:           cmd.Bool("debug"),
	}
}

// configLoadErrorBefore wraps a config.Load error (captured at command
// construction time) so it surfaces through cli's normal error path instead
// of a panic or a silently-ignored zero value once the command actually
// runs.
func configLoadErrorBefore(cfgErr error) cli.BeforeFunc {
	return func(_ context.Context, _ *cli.Command) (context.Context, error) {
		if cfgErr != nil {
			return nil, fmt.Errorf("config: %w", cfgErr)
		}
		return nil, nil
	}
}

// configDescription is the help text shared by every command that exposes
// configFlags, naming the resolved config file path.
func configDescription(cfgPath string) string {
	return fmt.Sprintf("Reads defaults from %s when present. Override with environment variables (OTELOP_HTTP, OTELOP_OTLP_GRPC, ...) or CLI flags.", cfgPath)
}
