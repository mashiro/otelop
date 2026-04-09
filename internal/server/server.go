package server

import (
	"context"
	"io/fs"
	"log"
	"net/http"

	"github.com/mashiro/otelop/internal/store"
	ws "github.com/mashiro/otelop/internal/websocket"
)

// Server serves the REST API, WebSocket, and embedded frontend.
type Server struct {
	store      *store.Store
	hub        *ws.Hub
	httpServer *http.Server
}

// New creates a new Server.
func New(addr string, s *store.Store, hub *ws.Hub, frontendFS fs.FS) *Server {
	srv := &Server{
		store: s,
		hub:   hub,
	}

	mux := http.NewServeMux()

	// REST API
	mux.HandleFunc("GET /api/traces", srv.handleGetTraces)
	mux.HandleFunc("GET /api/traces/{traceID}", srv.handleGetTraceByID)
	mux.HandleFunc("GET /api/metrics", srv.handleGetMetrics)
	mux.HandleFunc("GET /api/logs", srv.handleGetLogs)
	mux.HandleFunc("DELETE /api/clear", srv.handleClear)

	// WebSocket
	mux.HandleFunc("GET /ws", srv.handleWebSocket)

	// Static files with SPA fallback
	mux.Handle("/", spaHandler(frontendFS))

	srv.httpServer = &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	return srv
}

// Start starts the HTTP server. It blocks until the server is shut down.
func (s *Server) Start(_ context.Context) error {
	log.Printf("HTTP server listening on %s", s.httpServer.Addr)
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully shuts down the HTTP server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

// spaHandler serves static files from the given filesystem, falling back to index.html
// for paths that don't match a real file (SPA routing).
func spaHandler(fsys fs.FS) http.Handler {
	fileServer := http.FileServerFS(fsys)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try to open the file. If it doesn't exist, serve index.html.
		path := r.URL.Path
		if path == "/" {
			path = "index.html"
		} else if path[0] == '/' {
			path = path[1:]
		}

		_, err := fs.Stat(fsys, path)
		if err != nil {
			// File not found, serve index.html for SPA routing.
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})
}

func (s *Server) handleClear(w http.ResponseWriter, _ *http.Request) {
	s.store.Clear()
	w.WriteHeader(http.StatusNoContent)
}
