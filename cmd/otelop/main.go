package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	otelop "github.com/mashiro/otelop"
	"github.com/mashiro/otelop/internal/collector"
	otelopexporter "github.com/mashiro/otelop/internal/exporter"
	"github.com/mashiro/otelop/internal/server"
	"github.com/mashiro/otelop/internal/store"
	ws "github.com/mashiro/otelop/internal/websocket"
)

func main() {
	// CLI flags
	httpAddr := flag.String("http", ":4319", "HTTP server listen address (Web UI + REST API)")
	otlpGRPCAddr := flag.String("otlp-grpc", "0.0.0.0:4317", "OTLP gRPC receiver endpoint")
	otlpHTTPAddr := flag.String("otlp-http", "0.0.0.0:4318", "OTLP HTTP receiver endpoint")
	traceCap := flag.Int("trace-cap", 1000, "max number of traces to keep in memory")
	metricCap := flag.Int("metric-cap", 3000, "max number of metric series to keep in memory")
	logCap := flag.Int("log-cap", 1000, "max number of log entries to keep in memory")
	logLevel := flag.String("log-level", "warn", "collector log level (debug, info, warn, error)")
	flag.Parse()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// WebSocket hub
	hub := ws.NewHub()
	go hub.Run(ctx)

	// In-memory store wired to hub broadcast
	s := store.NewStore(*traceCap, *metricCap, *logCap, func(sig store.SignalType, data any) {
		hub.Broadcast(ws.Message{Type: sig, Data: data})
	})

	// HTTP server (REST API + static files + WebSocket)
	frontendFS := otelop.FrontendFS()
	srv := server.New(*httpAddr, s, hub, frontendFS)
	go func() {
		if err := srv.Start(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// OTel Collector (OTLP receiver → custom exporter → store)
	colCfg := collector.Config{
		GRPCEndpoint: *otlpGRPCAddr,
		HTTPEndpoint: *otlpHTTPAddr,
		LogLevel:     *logLevel,
	}
	exporterFactory := otelopexporter.NewFactory(s)
	col, err := collector.New(exporterFactory, colCfg)
	if err != nil {
		log.Fatalf("Failed to create collector: %v", err)
	}

	go func() {
		if err := col.Run(ctx); err != nil {
			log.Fatalf("Collector error: %v", err)
		}
	}()

	log.Println("otelop started")
	log.Printf("  OTLP gRPC %s", *otlpGRPCAddr)
	log.Printf("  OTLP HTTP %s", *otlpHTTPAddr)
	log.Printf("  Web UI    %s", *httpAddr)
	fmt.Fprintf(os.Stderr, "  Capacity  traces=%d metrics=%d logs=%d\n", *traceCap, *metricCap, *logCap)

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
}
