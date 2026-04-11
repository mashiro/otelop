package server

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAPIDebugLogger(t *testing.T) {
	origLogger := slog.Default()
	t.Cleanup(func() { slog.SetDefault(origLogger) })

	var buf bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})
	h := apiDebugLogger(next)

	tests := []struct {
		name      string
		path      string
		wantLog   bool
		wantKey   string
		wantQuery string
	}{
		{"api path is logged", "/api/traces", true, "status=418", ""},
		{"query string is logged", "/api/traces?limit=10&offset=5", true, "status=418", "limit=10&offset=5"},
		{"non-api path is skipped", "/index.html", false, "", ""},
		{"api prefix only match", "/apisomething", false, "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			buf.Reset()
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			logged := buf.String()
			if tt.wantLog {
				if !strings.Contains(logged, "api request") {
					t.Errorf("expected log line, got %q", logged)
				}
				if !strings.Contains(logged, tt.wantKey) {
					t.Errorf("expected log to contain %q, got %q", tt.wantKey, logged)
				}
				wantPath := tt.path
				if i := strings.Index(wantPath, "?"); i >= 0 {
					wantPath = wantPath[:i]
				}
				if !strings.Contains(logged, "path="+wantPath) {
					t.Errorf("expected log to contain path, got %q", logged)
				}
				if tt.wantQuery != "" && !strings.Contains(logged, tt.wantQuery) {
					t.Errorf("expected log to contain query %q, got %q", tt.wantQuery, logged)
				}
				if tt.wantQuery == "" && strings.Contains(logged, "query=") {
					t.Errorf("expected no query attr, got %q", logged)
				}
			} else if logged != "" {
				t.Errorf("expected no log output for %s, got %q", tt.path, logged)
			}
		})
	}
}

func TestAPIDebugLogger_SkipsWhenDebugDisabled(t *testing.T) {
	origLogger := slog.Default()
	t.Cleanup(func() { slog.SetDefault(origLogger) })

	var buf bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := apiDebugLogger(next)

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/traces", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if buf.Len() != 0 {
		t.Errorf("expected no output when debug disabled, got %q", buf.String())
	}
}
