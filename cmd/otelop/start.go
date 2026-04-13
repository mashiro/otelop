package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/urfave/cli/v3"
	"go.opentelemetry.io/collector/otelcol"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"

	otelop "github.com/mashiro/otelop"
	"github.com/mashiro/otelop/internal/collector"
	"github.com/mashiro/otelop/internal/config"
	"github.com/mashiro/otelop/internal/daemon"
	otelopexporter "github.com/mashiro/otelop/internal/exporter"
	otelopgraphql "github.com/mashiro/otelop/internal/graphql"
	"github.com/mashiro/otelop/internal/logger"
	"github.com/mashiro/otelop/internal/selftelemetry"
	"github.com/mashiro/otelop/internal/server"
	"github.com/mashiro/otelop/internal/store"
	ws "github.com/mashiro/otelop/internal/websocket"
)

func startCommand() *cli.Command {
	// Load the TOML config file once at command-construction time. Its
	// values become each flag's Default, so the resolved precedence is:
	//   CLI flag > env var (Sources) > config file (Default) > built-in.
	// A missing file is silently treated as "all defaults". A parse error
	// is fatal at the next runtime call, surfaced from runStart.
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
			&cli.BoolFlag{
				Name:    "foreground",
				Aliases: []string{"f"},
				Usage:   "run in the foreground instead of detaching",
			},
			&cli.StringFlag{Name: "http", Value: cfg.HTTPAddr, Usage: "Web UI + REST API listen address", Sources: cli.EnvVars("OTELOP_HTTP")},
			&cli.StringFlag{Name: "otlp-grpc", Value: cfg.OTLPGRPCAddr, Usage: "OTLP gRPC receiver endpoint", Sources: cli.EnvVars("OTELOP_OTLP_GRPC")},
			&cli.StringFlag{Name: "otlp-http", Value: cfg.OTLPHTTPAddr, Usage: "OTLP HTTP receiver endpoint", Sources: cli.EnvVars("OTELOP_OTLP_HTTP")},
			&cli.IntFlag{Name: "trace-cap", Value: cfg.TraceCap, Usage: "max traces to keep in memory", Sources: cli.EnvVars("OTELOP_TRACE_CAP")},
			&cli.IntFlag{Name: "metric-cap", Value: cfg.MetricCap, Usage: "max metric series to keep in memory", Sources: cli.EnvVars("OTELOP_METRIC_CAP")},
			&cli.IntFlag{Name: "log-cap", Value: cfg.LogCap, Usage: "max log entries to keep in memory", Sources: cli.EnvVars("OTELOP_LOG_CAP")},
			&cli.IntFlag{Name: "max-data-points", Value: cfg.MaxDataPoints, Usage: "max data points per metric series", Sources: cli.EnvVars("OTELOP_MAX_DATA_POINTS")},
			&cli.StringFlag{Name: "log-level", Value: cfg.LogLevel, Usage: "log level (debug|info|warn|error)", Sources: cli.EnvVars("OTELOP_LOG_LEVEL")},
			&cli.BoolFlag{Name: "debug", Value: cfg.Debug, Usage: "export otelop's own telemetry to itself", Sources: cli.EnvVars("OTELOP_DEBUG")},
		},
		Action:      runStart,
		Description: fmt.Sprintf("Reads defaults from %s when present. Override with environment variables (OTELOP_HTTP, OTELOP_OTLP_GRPC, ...) or CLI flags.", cfgPath),
	}
}

type startOptions struct {
	HTTPAddr      string
	OTLPGRPCAddr  string
	OTLPHTTPAddr  string
	TraceCap      int
	MetricCap     int
	LogCap        int
	MaxDataPoints int
	LogLevel      string
	Debug         bool
	Foreground    bool
}

func optionsFromCmd(cmd *cli.Command) startOptions {
	return startOptions{
		HTTPAddr:      cmd.String("http"),
		OTLPGRPCAddr:  cmd.String("otlp-grpc"),
		OTLPHTTPAddr:  cmd.String("otlp-http"),
		TraceCap:      cmd.Int("trace-cap"),
		MetricCap:     cmd.Int("metric-cap"),
		LogCap:        cmd.Int("log-cap"),
		MaxDataPoints: cmd.Int("max-data-points"),
		LogLevel:      cmd.String("log-level"),
		Debug:         cmd.Bool("debug"),
		Foreground:    cmd.Bool("foreground"),
	}
}

func runStart(ctx context.Context, cmd *cli.Command) error {
	opts := optionsFromCmd(cmd)
	if !daemon.IsDaemonChild() && !opts.Foreground {
		return runDaemonParent(ctx)
	}
	return runServer(ctx, opts)
}

// runServer runs the HTTP server, collector, and self-telemetry, then
// blocks until SIGINT/SIGTERM. When invoked by the detached daemon child it
// also persists metadata and signals the parent via the inherited pipe.
func runServer(ctx context.Context, opts startOptions) error {
	ready := daemon.ReadyPipe()
	rt, err := bootstrap(ctx, opts)
	if err != nil {
		daemon.SignalError(ready, err)
		return err
	}
	defer rt.shutdown()

	if ready != nil {
		meta := daemon.Metadata{
			PID:          os.Getpid(),
			StartedAt:    rt.startedAt,
			HTTPAddr:     opts.HTTPAddr,
			OTLPGRPCAddr: opts.OTLPGRPCAddr,
			OTLPHTTPAddr: opts.OTLPHTTPAddr,
			Version:      version,
		}
		if err := daemon.WriteMetadata(meta); err != nil {
			daemon.SignalError(ready, err)
			return err
		}
		// Acquire an advisory flock on the metadata file and hold the fd
		// for the rest of the process lifetime. `otelop status`/`stop`
		// probe this lock to distinguish a live daemon from stale
		// metadata, which makes the check immune to PID recycling after a
		// crash.
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
		rt.printBanner(os.Stderr, opts)
	}

	rt.waitForSignal(ctx)
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
		{"Log", logPath},
	})
	_, _ = fmt.Fprintln(os.Stderr, "  Use `otelop status` to inspect, `otelop stop` to shut down.")
	return nil
}

type runtime struct {
	cancel            context.CancelFunc
	startedAt         time.Time
	store             *store.Store
	hub               *ws.Hub
	srv               *server.Server
	col               *otelcol.Collector
	shutdownTelemetry func(context.Context) error
}

func bootstrap(ctx context.Context, opts startOptions) (*runtime, error) {
	level, err := logger.ParseLevel(opts.LogLevel)
	if err != nil {
		return nil, err
	}
	logger.Setup(level)

	ctx, cancel := context.WithCancel(ctx)

	rt := &runtime{
		cancel:    cancel,
		startedAt: time.Now(),
	}

	rt.hub = ws.NewHub()
	go rt.hub.Run(ctx)

	rt.store = store.NewStore(opts.TraceCap, opts.MetricCap, opts.LogCap, opts.MaxDataPoints, func(sig store.SignalType, data any) {
		rt.hub.Broadcast(ws.Message{Type: sig, Data: data})
	})

	runtimeInfo := otelopgraphql.RuntimeInfo{
		Version:      version,
		StartedAt:    rt.startedAt,
		HTTPAddr:     opts.HTTPAddr,
		OTLPGRPCAddr: opts.OTLPGRPCAddr,
		OTLPHTTPAddr: opts.OTLPHTTPAddr,
		Debug:        opts.Debug,
	}
	rt.srv = server.New(rt.store, rt.hub, otelop.FrontendFS(), runtimeInfo)

	// Eager listen so port conflicts surface before we signal ready.
	if err := rt.srv.Listen(ctx); err != nil {
		rt.shutdown()
		return nil, fmt.Errorf("bind %s: %w", opts.HTTPAddr, err)
	}
	go func() {
		if err := rt.srv.Start(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP server error", "error", err)
			rt.cancel()
		}
	}()

	slog.Debug("starting collector", "grpc", opts.OTLPGRPCAddr, "http", opts.OTLPHTTPAddr)
	col, err := collector.New(otelopexporter.NewFactory(rt.store), collector.Config{
		GRPCEndpoint: opts.OTLPGRPCAddr,
		HTTPEndpoint: opts.OTLPHTTPAddr,
		LogLevel:     opts.LogLevel,
	})
	if err != nil {
		rt.shutdown()
		return nil, fmt.Errorf("failed to create collector: %w", err)
	}
	rt.col = col

	colErrCh := make(chan error, 1)
	go func() {
		if err := col.Run(ctx); err != nil {
			colErrCh <- err
		}
		close(colErrCh)
	}()

	if err := waitCollectorReady(ctx, col, colErrCh); err != nil {
		rt.shutdown()
		return nil, err
	}

	if opts.Debug {
		endpoint, err := resolveLoopback(opts.OTLPGRPCAddr)
		if err != nil {
			rt.shutdown()
			return nil, fmt.Errorf("invalid otlp-grpc address: %w", err)
		}
		slog.Debug("starting self-telemetry", "endpoint", endpoint)
		result, err := selftelemetry.Setup(ctx, endpoint)
		if err != nil {
			rt.shutdown()
			return nil, fmt.Errorf("failed to setup self-telemetry: %w", err)
		}
		rt.shutdownTelemetry = result.Shutdown

		otelHandler := otelslog.NewHandler("otelop", otelslog.WithLoggerProvider(result.LoggerProvider))
		logger.Setup(level, otelHandler)

		if err := registerMetrics(rt.store, rt.hub); err != nil {
			rt.shutdown()
			return nil, fmt.Errorf("failed to register metrics: %w", err)
		}
	}

	return rt, nil
}

// waitCollectorReady blocks until col reports StateRunning, an error is
// observed on errCh, or the budget elapses. Replaces the old 500 ms blind
// sleep — successful binds now return in ~10-50 ms.
func waitCollectorReady(ctx context.Context, col *otelcol.Collector, errCh <-chan error) error {
	const budget = 2 * time.Second
	const tick = 10 * time.Millisecond
	deadline := time.NewTimer(budget)
	defer deadline.Stop()
	ticker := time.NewTicker(tick)
	defer ticker.Stop()
	for {
		select {
		case err, ok := <-errCh:
			if !ok {
				return errors.New("collector exited before becoming ready")
			}
			if err != nil {
				return fmt.Errorf("collector failed to start: %w", err)
			}
		case <-ticker.C:
		case <-deadline.C:
			return fmt.Errorf("collector did not become ready within %s", budget)
		case <-ctx.Done():
			return ctx.Err()
		}
		if col.GetState() == otelcol.StateRunning {
			return nil
		}
	}
}

func (r *runtime) printBanner(w io.Writer, opts startOptions) {
	suffix := ""
	if opts.Debug {
		suffix = " (debug)"
	}
	writeBanner(w, suffix, bannerRows{
		{"Web UI", "http://" + webUIDisplay(opts.HTTPAddr)},
		{"OTLP gRPC", opts.OTLPGRPCAddr},
		{"OTLP HTTP", opts.OTLPHTTPAddr},
		{"Capacity", fmt.Sprintf("traces=%d, metrics=%d, logs=%d, points/metric=%d",
			opts.TraceCap, opts.MetricCap, opts.LogCap, opts.MaxDataPoints)},
	})
}

func (r *runtime) waitForSignal(ctx context.Context) {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-sigCh:
	case <-ctx.Done():
	}
	slog.Info("shutting down...")
}

func (r *runtime) shutdown() {
	if r == nil {
		return
	}
	shutdownCtx := context.Background()
	if r.shutdownTelemetry != nil {
		if err := r.shutdownTelemetry(shutdownCtx); err != nil {
			slog.Error("self-telemetry shutdown error", "error", err)
		}
	}
	if r.col != nil {
		r.col.Shutdown()
	}
	if r.srv != nil {
		if err := r.srv.Shutdown(shutdownCtx); err != nil {
			slog.Error("HTTP server shutdown error", "error", err)
		}
	}
	if r.cancel != nil {
		r.cancel()
	}
}

func registerMetrics(s *store.Store, hub *ws.Hub) error {
	meter := otel.Meter("otelop")

	traceGauge, err := meter.Int64ObservableGauge("otelop.store.traces",
		metric.WithDescription("Number of traces in the store"),
	)
	if err != nil {
		return err
	}
	metricGauge, err := meter.Int64ObservableGauge("otelop.store.metrics",
		metric.WithDescription("Number of metric series in the store"),
	)
	if err != nil {
		return err
	}
	logGauge, err := meter.Int64ObservableGauge("otelop.store.logs",
		metric.WithDescription("Number of log entries in the store"),
	)
	if err != nil {
		return err
	}
	if _, err := meter.RegisterCallback(func(_ context.Context, o metric.Observer) error {
		traces, metrics, logs := s.Len()
		o.ObserveInt64(traceGauge, int64(traces))
		o.ObserveInt64(metricGauge, int64(metrics))
		o.ObserveInt64(logGauge, int64(logs))
		return nil
	}, traceGauge, metricGauge, logGauge); err != nil {
		return err
	}
	_, err = meter.Int64ObservableGauge("otelop.websocket.clients",
		metric.WithDescription("Number of connected WebSocket clients"),
		metric.WithInt64Callback(func(_ context.Context, o metric.Int64Observer) error {
			o.Observe(int64(hub.ClientCount()))
			return nil
		}),
	)
	return err
}
