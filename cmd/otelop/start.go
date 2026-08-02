package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"

	"github.com/urfave/cli/v3"

	"github.com/mashiro/otelop/internal/config"
	"github.com/mashiro/otelop/internal/daemon"
	otelruntime "github.com/mashiro/otelop/internal/runtime"
)

func startCommand(version string) *cli.Command {
	cfg, cfgPath, cfgErr := config.Load()

	return &cli.Command{
		Name:  "start",
		Usage: "Start the otelop server (backgrounded by default)",
		Before: func(_ context.Context, _ *cli.Command) (context.Context, error) {
			if cfgErr != nil {
				return nil, fmt.Errorf("config: %w", cfgErr)
			}
			return nil, nil
		},
		Flags: []cli.Flag{
			&cli.BoolFlag{Name: "foreground", Aliases: []string{"f"}, Usage: "run in the foreground instead of detaching"},
			&cli.StringFlag{Name: "http", Value: cfg.HTTPAddr, Usage: "Web UI + REST API listen address", Sources: cli.EnvVars("OTELOP_HTTP")},
			&cli.StringFlag{Name: "otlp-grpc", Value: cfg.OTLPGRPCAddr, Usage: "OTLP gRPC receiver endpoint", Sources: cli.EnvVars("OTELOP_OTLP_GRPC")},
			&cli.StringFlag{Name: "otlp-http", Value: cfg.OTLPHTTPAddr, Usage: "OTLP HTTP receiver endpoint", Sources: cli.EnvVars("OTELOP_OTLP_HTTP")},
			&cli.StringFlag{Name: "allowed-hosts", Value: strings.Join(cfg.AllowedHosts, ","), Usage: "comma-separated hostnames to allow beyond loopback/IP literals, e.g. otelop.internal,*.example.com", Sources: cli.EnvVars("OTELOP_ALLOWED_HOSTS")},
			&cli.StringFlag{Name: "proxy-url", Value: cfg.Proxy.URL, Usage: "upstream OTLP endpoint for forwarding", Sources: cli.EnvVars("OTELOP_PROXY_URL")},
			&cli.StringFlag{Name: "proxy-protocol", Value: cfg.Proxy.Protocol, Usage: "upstream OTLP protocol (grpc|http)", Sources: cli.EnvVars("OTELOP_PROXY_PROTOCOL")},
			&cli.StringFlag{Name: "proxy-auth-type", Value: cfg.Proxy.Auth.Type, Usage: "upstream OTLP auth type (bearer|basic|headers)", Sources: cli.EnvVars("OTELOP_PROXY_AUTH_TYPE")},
			&cli.StringFlag{Name: "proxy-auth-token", Value: cfg.Proxy.Auth.Token, Usage: "upstream bearer token", Sources: cli.EnvVars("OTELOP_PROXY_AUTH_TOKEN")},
			&cli.StringFlag{Name: "proxy-auth-username", Value: cfg.Proxy.Auth.Username, Usage: "upstream basic auth username", Sources: cli.EnvVars("OTELOP_PROXY_AUTH_USERNAME")},
			&cli.StringFlag{Name: "proxy-auth-password", Value: cfg.Proxy.Auth.Password, Usage: "upstream basic auth password", Sources: cli.EnvVars("OTELOP_PROXY_AUTH_PASSWORD")},
			&cli.StringSliceFlag{Name: "proxy-header", Value: headerPairs(cfg.Proxy.Auth.Headers), Usage: "upstream header in key=value form (repeatable)", Sources: cli.EnvVars("OTELOP_PROXY_HEADERS")},
			&cli.StringFlag{Name: "storage-path", Value: cfg.Storage.Path, Usage: "DuckDB database file path (empty = XDG default)", Sources: cli.EnvVars("OTELOP_STORAGE_PATH")},
			&cli.StringFlag{Name: "retention", Value: cfg.Storage.Retention, Usage: "how long to keep telemetry (e.g. 7d, 168h)", Sources: cli.EnvVars("OTELOP_RETENTION")},
			&cli.StringFlag{Name: "max-size", Value: cfg.Storage.MaxSize, Usage: "on-disk size ceiling (e.g. 4GB, 4GiB)", Sources: cli.EnvVars("OTELOP_MAX_SIZE")},
			&cli.IntFlag{Name: "render-window-max", Value: cfg.UI.RenderWindowMax, Usage: "max rows the traces/metrics/logs tables render at once", Sources: cli.EnvVars("OTELOP_RENDER_WINDOW_MAX")},
			&cli.StringFlag{Name: "log-level", Value: cfg.LogLevel, Usage: "log level (debug|info|warn|error)", Sources: cli.EnvVars("OTELOP_LOG_LEVEL")},
			&cli.BoolFlag{Name: "debug", Value: cfg.Debug, Usage: "export otelop's own telemetry to itself", Sources: cli.EnvVars("OTELOP_DEBUG")},
		},
		Action: func(ctx context.Context, cmd *cli.Command) error {
			return runStart(ctx, cmd, version)
		},
		Description: fmt.Sprintf("Reads defaults from %s when present. Override with environment variables (OTELOP_HTTP, OTELOP_OTLP_GRPC, ...) or CLI flags.", cfgPath),
	}
}

type startOptions struct {
	runtime    otelruntime.Options
	foreground bool
}

func optionsFromCmd(cmd *cli.Command, version string) startOptions {
	return startOptions{
		runtime: otelruntime.Options{
			Version:         version,
			HTTPAddr:        cmd.String("http"),
			OTLPGRPCAddr:    cmd.String("otlp-grpc"),
			OTLPHTTPAddr:    cmd.String("otlp-http"),
			AllowedHosts:    splitCSV(cmd.String("allowed-hosts")),
			ProxyURL:        strings.TrimSpace(cmd.String("proxy-url")),
			ProxyProtocol:   strings.ToLower(strings.TrimSpace(cmd.String("proxy-protocol"))),
			StoragePath:     strings.TrimSpace(cmd.String("storage-path")),
			Retention:       cmd.String("retention"),
			MaxSize:         cmd.String("max-size"),
			RenderWindowMax: cmd.Int("render-window-max"),
			LogLevel:        cmd.String("log-level"),
			Debug:           cmd.Bool("debug"),
			ProxyAuth: otelruntime.ProxyAuthOptions{
				Type:     strings.ToLower(strings.TrimSpace(cmd.String("proxy-auth-type"))),
				Token:    cmd.String("proxy-auth-token"),
				Username: cmd.String("proxy-auth-username"),
				Password: cmd.String("proxy-auth-password"),
				Headers:  parseHeaderArgs(cmd.StringSlice("proxy-header")),
			},
		},
		foreground: cmd.Bool("foreground"),
	}
}

func splitCSV(v string) []string {
	fields := strings.Split(v, ",")
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		f = strings.TrimSpace(f)
		if f != "" {
			out = append(out, f)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func runStart(ctx context.Context, cmd *cli.Command, version string) error {
	opts := optionsFromCmd(cmd, version)
	if err := otelruntime.Validate(opts.runtime); err != nil {
		return err
	}
	if !daemon.IsDaemonChild() && !opts.foreground {
		return runDaemonParent(ctx)
	}
	return runServer(ctx, opts.runtime)
}

func runServer(ctx context.Context, opts otelruntime.Options) error {
	ready := daemon.ReadyPipe()
	rt, err := otelruntime.Start(ctx, opts)
	if err != nil {
		daemon.SignalError(ready, err)
		return err
	}
	defer rt.Shutdown()

	if ready != nil {
		meta := daemon.Metadata{
			PID:           os.Getpid(),
			StartedAt:     rt.StartedAt(),
			HTTPAddr:      opts.HTTPAddr,
			OTLPGRPCAddr:  opts.OTLPGRPCAddr,
			OTLPHTTPAddr:  opts.OTLPHTTPAddr,
			ProxyURL:      otelruntime.RedactURL(opts.ProxyURL),
			ProxyProtocol: opts.ProxyProtocol,
			Version:       opts.Version,
		}
		if err := daemon.WriteMetadata(meta); err != nil {
			daemon.SignalError(ready, err)
			return err
		}
		lockFile, err := daemon.LockMetadata()
		if err != nil {
			_ = daemon.RemoveState()
			daemon.SignalError(ready, err)
			return err
		}
		defer func() { _ = lockFile.Close() }()
		defer func() { _ = daemon.RemoveState() }()
		daemon.SignalReady(ready)
	} else {
		printStartBanner(os.Stderr, opts)
	}

	waitForShutdown(ctx, rt.Done())
	return nil
}

func runDaemonParent(ctx context.Context) error {
	if _, err := daemon.EnsureStateDir(); err != nil {
		return err
	}

	existing, running, err := daemon.Running()
	if err == nil && existing != nil {
		if running {
			return fmt.Errorf("otelop is already running (pid %d, http %s) — use `otelop stop` first", existing.PID, existing.HTTPAddr)
		}
		_ = daemon.RemoveState()
	}

	logPath, err := daemon.LogFile()
	if err != nil {
		return err
	}
	if err := daemon.Spawn(ctx, logPath); err != nil {
		return fmt.Errorf("spawn daemon: %w", err)
	}

	meta, _ := daemon.ReadMetadata()
	if meta == nil {
		_, _ = fmt.Fprintf(os.Stderr, "otelop started (logs: %s)\n", logPath)
		return nil
	}
	writeBanner(os.Stderr, fmt.Sprintf(" started in the background (pid %d)", meta.PID), bannerRows{
		{"Web UI", "http://" + webUIDisplay(meta.HTTPAddr)},
		{"OTLP gRPC", meta.OTLPGRPCAddr},
		{"OTLP HTTP", meta.OTLPHTTPAddr},
		{"Proxy", formatProxyStatus(meta.ProxyURL, meta.ProxyProtocol)},
		{"Log", logPath},
	})
	_, _ = fmt.Fprintln(os.Stderr, "  Use `otelop status` to inspect, `otelop stop` to shut down.")
	return nil
}

func printStartBanner(w io.Writer, opts otelruntime.Options) {
	suffix := ""
	if opts.Debug {
		suffix = " (debug)"
	}
	storagePath, err := otelruntime.ResolveStoragePath(opts.StoragePath)
	if err != nil {
		storagePath = opts.StoragePath
	}
	writeBanner(w, suffix, bannerRows{
		{"Web UI", "http://" + webUIDisplay(opts.HTTPAddr)},
		{"OTLP gRPC", opts.OTLPGRPCAddr},
		{"OTLP HTTP", opts.OTLPHTTPAddr},
		{"Proxy", formatProxyStatus(opts.ProxyURL, opts.ProxyProtocol)},
		{"Storage", fmt.Sprintf("%s (retention=%s, max-size=%s)", storagePath, opts.Retention, opts.MaxSize)},
	})
}

func waitForShutdown(ctx context.Context, runtimeDone <-chan struct{}) {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sigCh)
	select {
	case <-sigCh:
	case <-ctx.Done():
	case <-runtimeDone:
	}
	slog.Info("shutting down...")
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

func formatProxyStatus(proxyURL, proxyProtocol string) string {
	if proxyURL == "" || proxyProtocol == "" {
		return "disabled"
	}
	return fmt.Sprintf("%s %s", strings.ToUpper(proxyProtocol), proxyURL)
}
