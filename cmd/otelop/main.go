package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/urfave/cli/v3"

	otelop "github.com/mashiro/otelop"
	"github.com/mashiro/otelop/internal/collector"
	otelopexporter "github.com/mashiro/otelop/internal/exporter"
	"github.com/mashiro/otelop/internal/server"
	"github.com/mashiro/otelop/internal/store"
	ws "github.com/mashiro/otelop/internal/websocket"
)

func main() {
	app := &cli.Command{
		Name:  "otelop",
		Usage: "Browser-based OpenTelemetry viewer",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:    "http",
				Value:   ":4319",
				Usage:   "Web UI + REST API listen address",
			},
			&cli.StringFlag{
				Name:    "otlp-grpc",
				Value:   "0.0.0.0:4317",
				Usage:   "OTLP gRPC receiver endpoint",
			},
			&cli.StringFlag{
				Name:    "otlp-http",
				Value:   "0.0.0.0:4318",
				Usage:   "OTLP HTTP receiver endpoint",
			},
			&cli.IntFlag{
				Name:    "trace-cap",
				Value:   1000,
				Usage:   "max traces to keep in memory",
			},
			&cli.IntFlag{
				Name:    "metric-cap",
				Value:   3000,
				Usage:   "max metric series to keep in memory",
			},
			&cli.IntFlag{
				Name:    "log-cap",
				Value:   1000,
				Usage:   "max log entries to keep in memory",
			},
			&cli.IntFlag{
				Name:    "max-data-points",
				Value:   1000,
				Usage:   "max data points per metric series",
			},
			&cli.StringFlag{
				Name:    "log-level",
				Value:   "warn",
				Usage:   "collector log level (debug|info|warn|error)",
			},
		},
		Action: run,
	}

	if err := app.Run(context.Background(), os.Args); err != nil {
		log.Fatal(err)
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

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// WebSocket hub
	hub := ws.NewHub()
	go hub.Run(ctx)

	// In-memory store wired to hub broadcast
	s := store.NewStore(traceCap, metricCap, logCap, maxDataPoints, func(sig store.SignalType, data any) {
		hub.Broadcast(ws.Message{Type: sig, Data: data})
	})

	// HTTP server (REST API + static files + WebSocket)
	frontendFS := otelop.FrontendFS()
	srv := server.New(httpAddr, s, hub, frontendFS)
	go func() {
		if err := srv.Start(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// OTel Collector (OTLP receiver → custom exporter → store)
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
			log.Fatalf("Collector error: %v", err)
		}
	}()

	log.Println("otelop started")
	log.Printf("  OTLP gRPC %s", otlpGRPCAddr)
	log.Printf("  OTLP HTTP %s", otlpHTTPAddr)
	log.Printf("  Web UI    %s", httpAddr)
	log.Printf("  Capacity  traces=%d metrics=%d logs=%d", traceCap, metricCap, logCap)

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down...")
	col.Shutdown()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}
	cancel()
	return nil
}
