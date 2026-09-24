package main

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/urfave/cli/v3"

	"github.com/mashiro/otelop/internal/config"
	otelruntime "github.com/mashiro/otelop/internal/runtime"
)

// configFlags is the flag set shared by `start` (plus --foreground), `info`,
// and `restart` (which reuses `start`'s command wholesale), so those
// commands can never disagree about how a config value resolves across CLI
// flag > env var > config file > default.
func configFlags(cfg config.Config) []cli.Flag {
	return []cli.Flag{
		&cli.StringFlag{Name: "http", Value: cfg.HTTPAddr, Usage: "Web UI + REST API listen address", Sources: cli.EnvVars("OTELOP_HTTP")},
		&cli.StringFlag{Name: "otlp-grpc", Value: cfg.OTLPGRPCAddr, Usage: "OTLP gRPC receiver endpoint", Sources: cli.EnvVars("OTELOP_OTLP_GRPC")},
		&cli.StringFlag{Name: "otlp-http", Value: cfg.OTLPHTTPAddr, Usage: "OTLP HTTP receiver endpoint", Sources: cli.EnvVars("OTELOP_OTLP_HTTP")},
		&cli.StringFlag{Name: "proxy-url", Value: cfg.Proxy.URL, Usage: "upstream OTLP endpoint for forwarding", Sources: cli.EnvVars("OTELOP_PROXY_URL")},
		&cli.StringFlag{Name: "proxy-protocol", Value: cfg.Proxy.Protocol, Usage: "upstream OTLP protocol (grpc|http)", Sources: cli.EnvVars("OTELOP_PROXY_PROTOCOL")},
		&cli.StringFlag{Name: "proxy-auth-type", Value: cfg.Proxy.Auth.Type, Usage: "upstream OTLP auth type (bearer|basic|headers)", Sources: cli.EnvVars("OTELOP_PROXY_AUTH_TYPE")},
		&cli.StringFlag{Name: "proxy-auth-token", Value: cfg.Proxy.Auth.Token, Usage: "upstream bearer token", Sources: cli.EnvVars("OTELOP_PROXY_AUTH_TOKEN")},
		&cli.StringFlag{Name: "proxy-auth-username", Value: cfg.Proxy.Auth.Username, Usage: "upstream basic auth username", Sources: cli.EnvVars("OTELOP_PROXY_AUTH_USERNAME")},
		&cli.StringFlag{Name: "proxy-auth-password", Value: cfg.Proxy.Auth.Password, Usage: "upstream basic auth password", Sources: cli.EnvVars("OTELOP_PROXY_AUTH_PASSWORD")},
		&cli.StringSliceFlag{Name: "proxy-auth-headers", Value: headerPairs(cfg.Proxy.Auth.Headers), Usage: "upstream header in key=value form (repeatable)", Sources: cli.EnvVars("OTELOP_PROXY_AUTH_HEADERS")},
		&cli.StringFlag{Name: "storage-path", Value: cfg.Storage.Path, Usage: "DuckDB database file path (empty = XDG default)", Sources: cli.EnvVars("OTELOP_STORAGE_PATH")},
		&cli.StringFlag{Name: "storage-retention", Value: cfg.Storage.Retention, Usage: "how long to keep telemetry (e.g. 7d, 168h)", Sources: cli.EnvVars("OTELOP_STORAGE_RETENTION")},
		&cli.StringFlag{Name: "storage-max-size", Value: cfg.Storage.MaxSize, Usage: "on-disk size ceiling (e.g. 4GB, 4GiB)", Sources: cli.EnvVars("OTELOP_STORAGE_MAX_SIZE")},
		&cli.StringFlag{Name: "storage-memory-limit", Value: cfg.Storage.MemoryLimit, Usage: "DuckDB memory ceiling (e.g. 512MB, 1GiB)", Sources: cli.EnvVars("OTELOP_STORAGE_MEMORY_LIMIT")},
		&cli.IntFlag{Name: "ui-render-window-max", Value: cfg.UI.RenderWindowMax, Usage: "max rows the traces/metrics/logs tables render at once", Sources: cli.EnvVars("OTELOP_UI_RENDER_WINDOW_MAX")},
		&cli.StringFlag{Name: "log-level", Value: cfg.LogLevel, Usage: "log level (debug|info|warn|error)", Sources: cli.EnvVars("OTELOP_LOG_LEVEL")},
		&cli.BoolFlag{Name: "debug", Value: cfg.Debug, Usage: "export otelop's own telemetry to itself", Sources: cli.EnvVars("OTELOP_DEBUG")},
	}
}

// runtimeOptionsFromCmd reads the flags configFlags defines off an already
// parsed command into otelruntime.Options.
func runtimeOptionsFromCmd(cmd *cli.Command, version string) otelruntime.Options {
	return otelruntime.Options{
		Version:         version,
		HTTPAddr:        cmd.String("http"),
		OTLPGRPCAddr:    cmd.String("otlp-grpc"),
		OTLPHTTPAddr:    cmd.String("otlp-http"),
		ProxyURL:        strings.TrimSpace(cmd.String("proxy-url")),
		ProxyProtocol:   strings.ToLower(strings.TrimSpace(cmd.String("proxy-protocol"))),
		StoragePath:     strings.TrimSpace(cmd.String("storage-path")),
		Retention:       cmd.String("storage-retention"),
		MaxSize:         cmd.String("storage-max-size"),
		MemoryLimit:     cmd.String("storage-memory-limit"),
		RenderWindowMax: cmd.Int("ui-render-window-max"),
		LogLevel:        cmd.String("log-level"),
		Debug:           cmd.Bool("debug"),
		ProxyAuth: otelruntime.ProxyAuthOptions{
			Type:     strings.ToLower(strings.TrimSpace(cmd.String("proxy-auth-type"))),
			Token:    cmd.String("proxy-auth-token"),
			Username: cmd.String("proxy-auth-username"),
			Password: cmd.String("proxy-auth-password"),
			Headers:  parseHeaderArgs(cmd.StringSlice("proxy-auth-headers")),
		},
	}
}

func parseHeaderArgs(args []string) map[string]string {
	if len(args) == 0 {
		return nil
	}
	out := make(map[string]string, len(args))
	for _, arg := range args {
		k, v, ok := strings.Cut(arg, "=")
		k = strings.TrimSpace(k)
		if ok && k != "" {
			out[k] = strings.TrimSpace(v)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func headerPairs(headers map[string]string) []string {
	keys := make([]string, 0, len(headers))
	for k := range headers {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		out = append(out, k+"="+headers[k])
	}
	return out
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
