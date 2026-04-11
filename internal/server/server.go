package server

import (
	"context"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/CAFxX/httpcompression"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/mashiro/otelop/internal/store"
	ws "github.com/mashiro/otelop/internal/websocket"
)

// Server serves the REST API, WebSocket, and embedded frontend.
type Server struct {
	store      *store.Store
	hub        *ws.Hub
	httpServer *http.Server
}

// New creates a new Server. When debug is true, HTTP requests are
// instrumented with OpenTelemetry spans via otelhttp.
func New(addr string, s *store.Store, hub *ws.Hub, frontendFS fs.FS, debug bool) *Server {
	srv := &Server{
		store: s,
		hub:   hub,
	}

	mux := http.NewServeMux()

	// REST API
	mux.HandleFunc("GET /api/config", srv.handleGetConfig)
	mux.HandleFunc("GET /api/traces", srv.handleGetTraces)
	mux.HandleFunc("GET /api/traces/{traceID}", srv.handleGetTraceByID)
	mux.HandleFunc("GET /api/metrics", srv.handleGetMetrics)
	mux.HandleFunc("GET /api/logs", srv.handleGetLogs)
	mux.HandleFunc("DELETE /api/clear", srv.handleClear)

	// WebSocket (no compression — it has its own framing)
	mux.HandleFunc("GET /ws", srv.handleWebSocket)

	// Static files with SPA fallback
	mux.Handle("/", spaHandler(frontendFS))

	// Log API requests at debug level before compression so status codes are accurate.
	logged := apiDebugLogger(mux)

	// Wrap with brotli/gzip/deflate compression, skipping WebSocket upgrades.
	var handler = logged
	if compress, err := httpcompression.DefaultAdapter(); err == nil {
		compressed := compress(logged)
		handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Upgrade") == "websocket" {
				logged.ServeHTTP(w, r)
				return
			}
			compressed.ServeHTTP(w, r)
		})
	}

	if debug {
		base := handler
		instrumented := otelhttp.NewHandler(base, "",
			otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
				if p := r.Pattern; p != "" && p != "/" {
					return p
				}
				return r.Method + " " + r.URL.Path
			}),
		)
		handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Upgrade") == "websocket" {
				base.ServeHTTP(w, r)
				return
			}
			instrumented.ServeHTTP(w, r)
		})
	}
	srv.httpServer = &http.Server{
		Addr:    addr,
		Handler: handler,
	}

	return srv
}

// Start starts the HTTP server. It blocks until the server is shut down.
func (s *Server) Start(_ context.Context) error {
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
		path := r.URL.Path
		if path == "/" {
			path = "index.html"
		} else if path[0] == '/' {
			path = path[1:]
		}

		_, err := fs.Stat(fsys, path)
		if err != nil {
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})
}

func (s *Server) handleGetConfig(w http.ResponseWriter, _ *http.Request) {
	traceCap, metricCap, logCap, maxDataPoints := s.store.Capacity()
	writeJSON(w, map[string]int{
		"traceCap":      traceCap,
		"metricCap":     metricCap,
		"logCap":        logCap,
		"maxDataPoints": maxDataPoints,
	})
}

func (s *Server) handleClear(w http.ResponseWriter, _ *http.Request) {
	s.store.Clear()
	w.WriteHeader(http.StatusNoContent)
}

// apiDebugLogger emits a slog.Debug record for every /api/* request with the
// method, path, response status, and elapsed time. Non-API paths (static
// assets, WebSocket) are passed through untouched.
func apiDebugLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || !slog.Default().Enabled(r.Context(), slog.LevelDebug) {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		rw := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)
		attrs := []any{
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"duration", time.Since(start),
		}
		if r.URL.RawQuery != "" {
			attrs = append(attrs, "query", r.URL.RawQuery)
		}
		slog.DebugContext(r.Context(), "api request", attrs...)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status  int
	written bool
}

func (r *statusRecorder) WriteHeader(code int) {
	if !r.written {
		r.status = code
		r.written = true
	}
	r.ResponseWriter.WriteHeader(code)
}
