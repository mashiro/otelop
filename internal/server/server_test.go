package server

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/coder/websocket"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	otelopgraphql "github.com/mashiro/otelop/internal/graphql"
	"github.com/mashiro/otelop/internal/storage"
	ws "github.com/mashiro/otelop/internal/websocket"
)

// newTestServer wires a Server with in-memory storage and an unstarted
// listener, so tests can drive it via httptest instead of binding a real
// port.
func newTestServer(t *testing.T) *Server {
	t.Helper()
	return newTestServerWithAllowedHosts(t, nil)
}

// newTestServerWithAllowedHosts is newTestServer with a non-empty
// allowed_hosts list, for tests exercising requireAllowedHost's allowlist
// path.
func newTestServerWithAllowedHosts(t *testing.T, allowedHosts []string) *Server {
	t.Helper()

	st, err := storage.Open(context.Background(), storage.Options{})
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() {
		if err := st.Close(); err != nil {
			t.Errorf("storage.Close: %v", err)
		}
	})

	hub := ws.NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go hub.Run(ctx)

	fsys := fstest.MapFS{"index.html": {Data: []byte("<html></html>")}}
	return New(st, hub, fsys, otelopgraphql.RuntimeInfo{}, allowedHosts)
}

func TestHandleWebSocket_OriginAllowlist(t *testing.T) {
	srv := newTestServer(t)
	ts := httptest.NewServer(srv.httpServer.Handler)
	t.Cleanup(ts.Close)
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"

	tests := []struct {
		name      string
		origin    string
		wantAllow bool
	}{
		{name: "evil origin rejected", origin: "http://evil.com", wantAllow: false},
		{name: "vite dev server origin allowed", origin: "http://localhost:5173", wantAllow: true},
		{name: "loopback IP origin allowed", origin: "http://127.0.0.1:5173", wantAllow: true},
		{name: "no origin header allowed (non-browser client)", origin: "", wantAllow: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			header := http.Header{}
			if tc.origin != "" {
				header.Set("Origin", tc.origin)
			}
			conn, resp, err := websocket.Dial(context.Background(), wsURL, &websocket.DialOptions{HTTPHeader: header})
			if resp != nil && resp.Body != nil {
				defer func() { _ = resp.Body.Close() }()
			}
			if tc.wantAllow {
				if err != nil {
					t.Fatalf("Dial: %v", err)
				}
				_ = conn.Close(websocket.StatusNormalClosure, "")
				return
			}
			if err == nil {
				_ = conn.Close(websocket.StatusNormalClosure, "")
				t.Fatalf("expected dial to fail for origin %q", tc.origin)
			}
			if resp == nil || resp.StatusCode != http.StatusForbidden {
				status := -1
				if resp != nil {
					status = resp.StatusCode
				}
				t.Errorf("status = %d, want %d", status, http.StatusForbidden)
			}
		})
	}
}

func TestGraphQL_CSRFProtection(t *testing.T) {
	srv := newTestServer(t)
	ts := httptest.NewServer(srv.httpServer.Handler)
	t.Cleanup(ts.Close)

	body := `{"query":"{ status { version } }"}`

	tests := []struct {
		name       string
		path       string
		headers    map[string]string
		wantStatus func(int) bool
	}{
		{
			name: "cross-site graphql mutation blocked",
			path: "/graphql",
			headers: map[string]string{
				"Sec-Fetch-Site": "cross-site",
				"Origin":         "http://evil.com",
				"Content-Type":   "application/json",
			},
			wantStatus: func(code int) bool { return code == http.StatusForbidden },
		},
		{
			name: "no browser headers allowed (curl, scripts)",
			path: "/graphql",
			headers: map[string]string{
				"Content-Type": "application/json",
			},
			wantStatus: func(code int) bool { return code != http.StatusForbidden },
		},
		{
			name: "vite dev proxy same-origin allowed",
			path: "/graphql",
			headers: map[string]string{
				"Sec-Fetch-Site": "same-origin",
				"Origin":         "http://localhost:5173",
				"Content-Type":   "application/json",
			},
			wantStatus: func(code int) bool { return code != http.StatusForbidden },
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, ts.URL+tc.path, strings.NewReader(body))
			if err != nil {
				t.Fatalf("NewRequestWithContext: %v", err)
			}
			for k, v := range tc.headers {
				req.Header.Set(k, v)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("Do: %v", err)
			}
			defer func() { _ = resp.Body.Close() }()
			if !tc.wantStatus(resp.StatusCode) {
				t.Errorf("path %s: status = %d", tc.path, resp.StatusCode)
			}
		})
	}
}

func TestHostHeaderValidation(t *testing.T) {
	srv := newTestServer(t)
	ts := httptest.NewServer(srv.httpServer.Handler)
	t.Cleanup(ts.Close)

	tests := []struct {
		name          string
		method        string
		path          string
		host          string
		wantForbidden bool
	}{
		{name: "graphql dns rebind host blocked", method: http.MethodPost, path: "/graphql", host: "evil.com:4319", wantForbidden: true},
		{name: "graphql ip literal host allowed", method: http.MethodPost, path: "/graphql", host: "192.168.1.5:4319", wantForbidden: false},
		{name: "graphql localhost host allowed", method: http.MethodPost, path: "/graphql", host: "localhost:4319", wantForbidden: false},
		{name: "ws dns rebind host blocked", method: http.MethodGet, path: "/ws", host: "evil.com:4319", wantForbidden: true},
		{name: "ws ip literal host allowed", method: http.MethodGet, path: "/ws", host: "192.168.1.5:4319", wantForbidden: false},
		{name: "static assets ignore host check", method: http.MethodGet, path: "/", host: "evil.com:4319", wantForbidden: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var bodyReader io.Reader
			if tc.method == http.MethodPost {
				bodyReader = strings.NewReader(`{"query":"{ status { version } }"}`)
			}
			req, err := http.NewRequestWithContext(context.Background(), tc.method, ts.URL+tc.path, bodyReader)
			if err != nil {
				t.Fatalf("NewRequestWithContext: %v", err)
			}
			req.Host = tc.host
			if tc.method == http.MethodPost {
				req.Header.Set("Content-Type", "application/json")
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("Do: %v", err)
			}
			defer func() { _ = resp.Body.Close() }()
			gotForbidden := resp.StatusCode == http.StatusForbidden
			if gotForbidden != tc.wantForbidden {
				t.Errorf("status = %d, wantForbidden = %v", resp.StatusCode, tc.wantForbidden)
			}
		})
	}
}

func TestHostHeaderValidation_AllowedHosts(t *testing.T) {
	srv := newTestServerWithAllowedHosts(t, []string{"otelop.internal", "*.example.com"})
	ts := httptest.NewServer(srv.httpServer.Handler)
	t.Cleanup(ts.Close)

	tests := []struct {
		name          string
		host          string
		wantForbidden bool
	}{
		{name: "exact allowlist match", host: "otelop.internal:4319", wantForbidden: false},
		{name: "allowlist match is case-insensitive", host: "OTELOP.INTERNAL:4319", wantForbidden: false},
		{name: "wildcard entry matches subdomain", host: "app.example.com:4319", wantForbidden: false},
		{name: "wildcard entry matches bare domain", host: "example.com:4319", wantForbidden: false},
		{name: "loopback still allowed alongside allowlist", host: "127.0.0.1:4319", wantForbidden: false},
		{name: "host outside allowlist still blocked", host: "evil.com:4319", wantForbidden: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, ts.URL+"/graphql", strings.NewReader(`{"query":"{ status { version } }"}`))
			if err != nil {
				t.Fatalf("NewRequestWithContext: %v", err)
			}
			req.Host = tc.host
			req.Header.Set("Content-Type", "application/json")
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("Do: %v", err)
			}
			defer func() { _ = resp.Body.Close() }()
			gotForbidden := resp.StatusCode == http.StatusForbidden
			if gotForbidden != tc.wantForbidden {
				t.Errorf("status = %d, wantForbidden = %v", resp.StatusCode, tc.wantForbidden)
			}
		})
	}
}

func TestSpaHandler_EmitsStatAndServeSpans(t *testing.T) {
	orig := otel.GetTracerProvider()
	t.Cleanup(func() { otel.SetTracerProvider(orig) })

	fsys := fstest.MapFS{
		"index.html": {Data: []byte("<html></html>")},
		"app.js":     {Data: []byte("console.log(0)")},
	}

	h := spaHandler(fsys)

	tests := []struct {
		name      string
		path      string
		wantFound bool
	}{
		{name: "existing asset", path: "/app.js", wantFound: true},
		{name: "spa fallback", path: "/nonexistent/route", wantFound: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := tracetest.NewSpanRecorder()
			tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
			otel.SetTracerProvider(tp)

			rr := httptest.NewRecorder()
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, tc.path, nil)
			h.ServeHTTP(rr, req)

			var sawStat, sawServe bool
			for _, span := range rec.Ended() {
				switch span.Name() {
				case "spa.stat":
					sawStat = true
					var found *bool
					for _, a := range span.Attributes() {
						if string(a.Key) == "spa.found" {
							v := a.Value.AsBool()
							found = &v
						}
					}
					if found == nil {
						t.Errorf("spa.stat missing spa.found attribute")
					} else if *found != tc.wantFound {
						t.Errorf("spa.found = %v, want %v", *found, tc.wantFound)
					}
				case "spa.serve":
					sawServe = true
				}
			}
			if !sawStat {
				t.Errorf("expected spa.stat span")
			}
			if !sawServe {
				t.Errorf("expected spa.serve span")
			}
		})
	}
}
