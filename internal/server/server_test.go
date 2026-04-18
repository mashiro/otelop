package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

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
