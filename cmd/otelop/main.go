package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/urfave/cli/v3"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"

	otelop "github.com/mashiro/otelop"
	"github.com/mashiro/otelop/internal/collector"
	otelopexporter "github.com/mashiro/otelop/internal/exporter"
	"github.com/mashiro/otelop/internal/logger"
	"github.com/mashiro/otelop/internal/selftelemetry"
	"github.com/mashiro/otelop/internal/server"
	"github.com/mashiro/otelop/internal/store"
	ws "github.com/mashiro/otelop/internal/websocket"
)

var version = "dev"

func main() {
	app := &cli.Command{
		Name:  "otelop",
		Usage: "Browser-based OpenTelemetry viewer",
		Commands: []*cli.Command{
			{
				Name:  "version",
				Usage: "Print version",
				Action: func(_ context.Context, _ *cli.Command) error {
					fmt.Println(version)
					return nil
				},
			},
		},
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:  "http",
				Value: ":4319",
				Usage: "Web UI + REST API listen address",
			},
			&cli.StringFlag{
				Name:  "otlp-grpc",
				Value: "0.0.0.0:4317",
				Usage: "OTLP gRPC receiver endpoint",
			},
			&cli.StringFlag{
				Name:  "otlp-http",
				Value: "0.0.0.0:4318",
				Usage: "OTLP HTTP receiver endpoint",
			},
			&cli.IntFlag{
				Name:  "trace-cap",
				Value: 1000,
				Usage: "max traces to keep in memory",
			},
			&cli.IntFlag{
				Name:  "metric-cap",
				Value: 3000,
				Usage: "max metric series to keep in memory",
			},
			&cli.IntFlag{
				Name:  "log-cap",
				Value: 1000,
				Usage: "max log entries to keep in memory",
			},
			&cli.IntFlag{
				Name:  "max-data-points",
				Value: 1000,
				Usage: "max data points per metric series",
			},
			&cli.StringFlag{
				Name:  "log-level",
				Value: "warn",
				Usage: "log level (debug|info|warn|error)",
			},
			&cli.BoolFlag{
				Name:  "debug",
				Usage: "export otelop's own telemetry to itself",
			},
		},
		Action: run,
	}

	if err := app.Run(context.Background(), os.Args); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, cmd *cli.Command) error {
	httpAddr := cmd.String("http")
	otlpGRPCAddr := cmd.String("otlp-grpc")
	otlpHTTPAddr := cmd.String("otlp-http")
	traceCap := int(cmd.Int("trace-cap"))
	metricCap := int(cmd.Int("metric-cap"))
	logCap := int(cmd.Int("log-cap"))
	maxDataPoints := int(cmd.Int("max-data-points"))
	logLevel := cmd.String("log-level")
	debug := cmd.Bool("debug")

	level, err := logger.ParseLevel(logLevel)
	if err != nil {
		return err
	}
	logger.Setup(level)

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	hub := ws.NewHub()
	go hub.Run(ctx)

	s := store.NewStore(traceCap, metricCap, logCap, maxDataPoints, func(sig store.SignalType, data any) {
		hub.Broadcast(ws.Message{Type: sig, Data: data})
	})

	frontendFS := otelop.FrontendFS()
	srv := server.New(httpAddr, s, hub, frontendFS, debug)
	go func() {
		if err := srv.Start(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP server error", "error", err)
			os.Exit(1)
		}
	}()

	slog.Debug("starting collector", "grpc", otlpGRPCAddr, "http", otlpHTTPAddr)
	colCfg := collector.Config{
		GRPCEndpoint: otlpGRPCAddr,
		HTTPEndpoint: otlpHTTPAddr,
		LogLevel:     logLevel,
	}
	exporterFactory := otelopexporter.NewFactory(s)
	col, err := collector.New(exporterFactory, colCfg)
	if err != nil {
		return fmt.Errorf("failed to create collector: %w", err)
	}

	go func() {
		if err := col.Run(ctx); err != nil {
			slog.Error("collector error", "error", err)
			os.Exit(1)
		}
	}()

	var shutdownTelemetry func(context.Context) error
	if debug {
		endpoint, err := resolveLoopback(otlpGRPCAddr)
		if err != nil {
			return fmt.Errorf("invalid otlp-grpc address: %w", err)
		}
		slog.Debug("starting self-telemetry", "endpoint", endpoint)
		result, err := selftelemetry.Setup(ctx, endpoint)
		if err != nil {
			return fmt.Errorf("failed to setup self-telemetry: %w", err)
		}
		shutdownTelemetry = result.Shutdown

		otelHandler := otelslog.NewHandler("otelop", otelslog.WithLoggerProvider(result.LoggerProvider))
		logger.Setup(level, otelHandler)

		if err := registerMetrics(s, hub); err != nil {
			return fmt.Errorf("failed to register metrics: %w", err)
		}
	}

	displayAddr := httpAddr
	if len(displayAddr) > 0 && displayAddr[0] == ':' {
		displayAddr = "localhost" + displayAddr
	}

	debugLabel := ""
	if debug {
		debugLabel = " (debug)"
	}

	fmt.Fprintf(os.Stderr, `  %sotelop%s%s

  %-14s http://%s
  %-14s %s
  %-14s %s
  %-14s traces=%d, metrics=%d, logs=%d, points/metric=%d

`, "\033[1;36m", "\033[0m", debugLabel, "Web UI", displayAddr, "OTLP gRPC", otlpGRPCAddr, "OTLP HTTP", otlpHTTPAddr, "Capacity", traceCap, metricCap, logCap, maxDataPoints)

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	slog.Info("shutting down...")
	if shutdownTelemetry != nil {
		if err := shutdownTelemetry(ctx); err != nil {
			slog.Error("self-telemetry shutdown error", "error", err)
		}
	}
	col.Shutdown()
	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("HTTP server shutdown error", "error", err)
	}
	cancel()
	return nil
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

	_, err = meter.RegisterCallback(func(_ context.Context, o metric.Observer) error {
		traces, metrics, logs := s.Len()
		o.ObserveInt64(traceGauge, int64(traces))
		o.ObserveInt64(metricGauge, int64(metrics))
		o.ObserveInt64(logGauge, int64(logs))
		return nil
	}, traceGauge, metricGauge, logGauge)
	if err != nil {
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

// resolveLoopback converts a listen address (e.g. "0.0.0.0:4317") to a
// connectable loopback address (e.g. "localhost:4317").
func resolveLoopback(listenAddr string) (string, error) {
	host, port, err := net.SplitHostPort(listenAddr)
	if err != nil {
		return "", err
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "localhost"
	}
	return host + ":" + port, nil
}
