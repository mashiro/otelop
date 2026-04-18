package server

import (
	"context"
	"io/fs"
	"net"
	"net/http"

	"github.com/CAFxX/httpcompression"
	gqlgo "github.com/graph-gophers/graphql-go"
	"github.com/graph-gophers/graphql-go/relay"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	oteltrace "go.opentelemetry.io/otel/trace"

	otelopgraphql "github.com/mashiro/otelop/internal/graphql"
	"github.com/mashiro/otelop/internal/mcp"
	"github.com/mashiro/otelop/internal/store"
	ws "github.com/mashiro/otelop/internal/websocket"
)

// tracer resolves the server tracer lazily so tests that swap the global
// provider still see their own span recorder.
func tracer() oteltrace.Tracer { return otel.Tracer("otelop/server") }

// Server serves the GraphQL endpoint, MCP endpoint, WebSocket stream, and
// embedded frontend.
type Server struct {
	store      *store.Store
	hub        *ws.Hub
	schema     *gqlgo.Schema
	httpServer *http.Server
	listener   net.Listener
}

// New creates a new Server. When runtime.Debug is true, HTTP requests are
// instrumented with OpenTelemetry spans via otelhttp. runtime.Version is
// advertised via the MCP Implementation metadata at /mcp.
func New(s *store.Store, hub *ws.Hub, frontendFS fs.FS, runtime otelopgraphql.RuntimeInfo) *Server {
	srv := &Server{
		store:  s,
		hub:    hub,
		schema: otelopgraphql.MustNewSchema(s, runtime),
	}

	mux := http.NewServeMux()

	// GraphQL — primary data surface for the frontend and AI clients.
	mux.Handle("POST /graphql", &relay.Handler{Schema: srv.schema})

	// MCP — optional wrapper exposing the GraphQL schema as a single `query`
	// tool. Shares the parsed schema with /graphql to avoid a second parse at
	// startup.
	mux.Handle("/mcp", mcp.NewHandler(srv.schema, runtime.Version))

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

	if runtime.Debug {
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
		Addr:    runtime.HTTPAddr,
		Handler: handler,
	}

	return srv
}

// Listen binds the configured HTTP listener without serving. Splitting listen
// from Serve lets the daemon entry point report bind errors back to the
// parent before signaling "ready". Safe to call more than once.
func (s *Server) Listen(ctx context.Context) error {
	if s.listener != nil {
		return nil
	}
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", s.httpServer.Addr)
	if err != nil {
		return err
	}
	s.listener = ln
	return nil
}

// Start starts the HTTP server. It blocks until the server is shut down. If
// Listen has not been called yet, Start binds the listener itself.
func (s *Server) Start(ctx context.Context) error {
	if err := s.Listen(ctx); err != nil {
		return err
	}
	return s.httpServer.Serve(s.listener)
}

// Shutdown gracefully shuts down the HTTP server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

// spaHandler serves static files from the given filesystem, falling back to
// index.html for paths that don't match a real file (SPA routing). Emits
// child spans (spa.stat, spa.serve) so the otelhttp root span's duration can
// be split into existence-check vs file-serving vs wrapping middleware.
func spaHandler(fsys fs.FS) http.Handler {
	fileServer := http.FileServerFS(fsys)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			path = "index.html"
		} else if path[0] == '/' {
			path = path[1:]
		}

		ctx := r.Context()
		statCtx, statSpan := tracer().Start(ctx, "spa.stat")
		statSpan.SetAttributes(attribute.String("spa.path", path))
		_, err := fs.Stat(fsys, path)
		statSpan.SetAttributes(attribute.Bool("spa.found", err == nil))
		statSpan.End()
		_ = statCtx

		if err != nil {
			r.URL.Path = "/"
		}
		serveCtx, serveSpan := tracer().Start(ctx, "spa.serve")
		defer serveSpan.End()
		fileServer.ServeHTTP(w, r.WithContext(serveCtx))
	})
}
