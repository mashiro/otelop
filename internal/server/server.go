package server

import (
	"context"
	"io/fs"
	"net/http"

	"github.com/CAFxX/httpcompression"
	gqlgo "github.com/graph-gophers/graphql-go"
	"github.com/graph-gophers/graphql-go/relay"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	otelopgraphql "github.com/mashiro/otelop/internal/graphql"
	"github.com/mashiro/otelop/internal/mcp"
	"github.com/mashiro/otelop/internal/store"
	ws "github.com/mashiro/otelop/internal/websocket"
)

// Server serves the GraphQL endpoint, MCP endpoint, WebSocket stream, and
// embedded frontend.
type Server struct {
	store      *store.Store
	hub        *ws.Hub
	schema     *gqlgo.Schema
	httpServer *http.Server
}

// New creates a new Server. When debug is true, HTTP requests are
// instrumented with OpenTelemetry spans via otelhttp. The version string is
// advertised via the MCP Implementation metadata at /mcp.
func New(addr string, s *store.Store, hub *ws.Hub, frontendFS fs.FS, version string, debug bool) *Server {
	srv := &Server{
		store:  s,
		hub:    hub,
		schema: otelopgraphql.MustNewSchema(s),
	}

	mux := http.NewServeMux()

	// GraphQL — primary data surface for the frontend and AI clients.
	mux.Handle("POST /graphql", &relay.Handler{Schema: srv.schema})

	// MCP — optional wrapper exposing the GraphQL schema as a single `query`
	// tool. Shares the parsed schema with /graphql to avoid a second parse at
	// startup.
	mux.Handle("/mcp", mcp.NewHandler(srv.schema, version))

	// WebSocket (no compression — it has its own framing)
	mux.HandleFunc("GET /ws", srv.handleWebSocket)

	// Static files with SPA fallback
	mux.Handle("/", spaHandler(frontendFS))

	// Wrap with brotli/gzip/deflate compression, skipping WebSocket upgrades
	// and the MCP endpoint (which uses SSE for server→client streaming and
	// would break if the compressor buffered the response).
	var handler http.Handler = mux
	if compress, err := httpcompression.DefaultAdapter(); err == nil {
		compressed := compress(mux)
		handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Upgrade") == "websocket" || r.URL.Path == "/mcp" {
				mux.ServeHTTP(w, r)
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
