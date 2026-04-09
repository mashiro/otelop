package main

import (
	"context"
	"errors"
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
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// WebSocket hub
	hub := ws.NewHub()
	go hub.Run(ctx)

	// In-memory store wired to hub broadcast
	s := store.NewStore(1000, 3000, 1000, func(sig store.SignalType, data any) {
		hub.Broadcast(ws.Message{Type: sig, Data: data})
	})

	// HTTP server (REST API + static files + WebSocket)
	frontendFS := otelop.FrontendFS()
	srv := server.New(":8080", s, hub, frontendFS)
	go func() {
		if err := srv.Start(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// OTel Collector (OTLP receiver → custom exporter → store)
	exporterFactory := otelopexporter.NewFactory(s)
	col, err := collector.New(exporterFactory)
	if err != nil {
		log.Fatalf("Failed to create collector: %v", err)
	}

	go func() {
		if err := col.Run(ctx); err != nil {
			log.Fatalf("Collector error: %v", err)
		}
	}()

	log.Println("otelop started")
	log.Println("  OTLP gRPC :4317")
	log.Println("  OTLP HTTP :4318")
	log.Println("  Web UI    :8080")

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
