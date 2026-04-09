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

	"github.com/spf13/cobra"

	otelop "github.com/mashiro/otelop"
	"github.com/mashiro/otelop/internal/collector"
	otelopexporter "github.com/mashiro/otelop/internal/exporter"
	"github.com/mashiro/otelop/internal/server"
	"github.com/mashiro/otelop/internal/store"
	ws "github.com/mashiro/otelop/internal/websocket"
)

var (
	httpAddr     string
	otlpGRPCAddr string
	otlpHTTPAddr string
	traceCap     int
	metricCap    int
	logCap       int
	logLevel     string
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "otelop",
		Short: "Browser-based OpenTelemetry viewer",
		RunE:  run,
		SilenceUsage: true,
	}

	f := rootCmd.Flags()
	f.StringVar(&httpAddr, "http", ":4319", "Web UI + REST API listen address")
	f.StringVar(&otlpGRPCAddr, "otlp-grpc", "0.0.0.0:4317", "OTLP gRPC receiver endpoint")
	f.StringVar(&otlpHTTPAddr, "otlp-http", "0.0.0.0:4318", "OTLP HTTP receiver endpoint")
	f.IntVar(&traceCap, "trace-cap", 1000, "max traces to keep in memory")
	f.IntVar(&metricCap, "metric-cap", 3000, "max metric series to keep in memory")
	f.IntVar(&logCap, "log-cap", 1000, "max log entries to keep in memory")
	f.StringVar(&logLevel, "log-level", "warn", "collector log level (debug|info|warn|error)")

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func run(cmd *cobra.Command, _ []string) error {
	ctx, cancel := context.WithCancel(cmd.Context())
	defer cancel()

	// WebSocket hub
	hub := ws.NewHub()
	go hub.Run(ctx)

	// In-memory store wired to hub broadcast
	s := store.NewStore(traceCap, metricCap, logCap, func(sig store.SignalType, data any) {
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
