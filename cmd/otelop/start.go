package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/urfave/cli/v3"

	"github.com/mashiro/otelop/internal/config"
	"github.com/mashiro/otelop/internal/daemon"
	otelruntime "github.com/mashiro/otelop/internal/runtime"
)

func startCommand(version string) *cli.Command {
	cfg, cfgPath, cfgErr := config.Load()

	return &cli.Command{
		Name:   "start",
		Usage:  "Start the otelop server (backgrounded by default)",
		Before: configLoadErrorBefore(cfgErr),
		Flags: append([]cli.Flag{
			&cli.BoolFlag{Name: "foreground", Aliases: []string{"f"}, Usage: "run in the foreground instead of detaching"},
		}, configFlags(cfg)...),
		Action: func(ctx context.Context, cmd *cli.Command) error {
			return runStart(ctx, cmd, version)
		},
		Description: configDescription(cfgPath),
	}
}

func runStart(ctx context.Context, cmd *cli.Command, version string) error {
	opts := runtimeOptionsFromCmd(cmd, version)
	if err := otelruntime.Validate(opts); err != nil {
		return err
	}
	if !daemon.IsDaemonChild() && !cmd.Bool("foreground") {
		return runDaemonParent(ctx)
	}
	return runServer(ctx, opts)
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
		{"Proxy", formatProxy(meta.ProxyURL, meta.ProxyProtocol, "disabled")},
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
		{"Proxy", formatProxy(opts.ProxyURL, opts.ProxyProtocol, "disabled")},
		{"Storage", fmt.Sprintf("%s (retention=%s, max-size=%s, memory-limit=%s)", storagePath, opts.Retention, opts.MaxSize, opts.MemoryLimit)},
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
