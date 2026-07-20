package main

import (
	"bytes"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestValidateProxyOptions_RejectsSelfProxy(t *testing.T) {
	opts := startOptions{
		OTLPGRPCAddr:  "0.0.0.0:4317",
		OTLPHTTPAddr:  "0.0.0.0:4318",
		ProxyURL:      "http://127.0.0.1:4317",
		ProxyProtocol: "grpc",
	}
	err := validateProxyOptions(opts)
	if err == nil || !strings.Contains(err.Error(), "points back to otelop's own OTLP grpc listener") {
		t.Fatalf("validateProxyOptions error = %v", err)
	}
}

func TestValidateProxyOptions_RejectsCredentialsInURL(t *testing.T) {
	opts := startOptions{
		OTLPGRPCAddr:  "0.0.0.0:4317",
		OTLPHTTPAddr:  "0.0.0.0:4318",
		ProxyURL:      "https://user:pass@example.com:4318",
		ProxyProtocol: "http",
	}
	err := validateProxyOptions(opts)
	if err == nil || !strings.Contains(err.Error(), "must not contain embedded credentials") {
		t.Fatalf("validateProxyOptions error = %v", err)
	}
}

func TestValidateProxyOptions_BearerAuth(t *testing.T) {
	opts := startOptions{
		OTLPGRPCAddr:  "0.0.0.0:4317",
		OTLPHTTPAddr:  "0.0.0.0:4318",
		ProxyURL:      "https://collector.example.com:4318",
		ProxyProtocol: "http",
		ProxyAuth: proxyAuthOptions{
			Type:  "bearer",
			Token: "token",
		},
	}
	if err := validateProxyOptions(opts); err != nil {
		t.Fatalf("validateProxyOptions: %v", err)
	}
}

func TestValidateRenderWindowMax_RejectsLessThanOne(t *testing.T) {
	for _, v := range []int{0, -1, -500} {
		if err := validateRenderWindowMax(v); err == nil {
			t.Errorf("validateRenderWindowMax(%d) = nil, want error", v)
		}
	}
}

func TestValidateRenderWindowMax_AcceptsPositive(t *testing.T) {
	for _, v := range []int{1, 500, 10_000} {
		if err := validateRenderWindowMax(v); err != nil {
			t.Errorf("validateRenderWindowMax(%d) = %v, want nil", v, err)
		}
	}
}

func TestBuildProxyHeaders(t *testing.T) {
	headers := buildProxyHeaders(proxyAuthOptions{
		Type:     "basic",
		Username: "alice",
		Password: "secret",
	})
	got := headers["Authorization"]
	if got != "Basic YWxpY2U6c2VjcmV0" {
		t.Fatalf("Authorization = %q", got)
	}
}

func TestRedactURL(t *testing.T) {
	got := redactURL("https://user:pass@example.com:4318")
	if got != "https://REDACTED:REDACTED@example.com:4318" {
		t.Fatalf("redactURL = %q", got)
	}
}

func TestSplitCSV(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want []string
	}{
		{name: "empty", in: "", want: nil},
		{name: "whitespace only", in: "   ", want: nil},
		{name: "single", in: "otelop.internal", want: []string{"otelop.internal"}},
		{name: "multiple", in: "otelop.internal,*.example.com", want: []string{"otelop.internal", "*.example.com"}},
		{name: "trims whitespace and drops empties", in: " otelop.internal ,, *.example.com ", want: []string{"otelop.internal", "*.example.com"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := splitCSV(tc.in)
			if !slices.Equal(got, tc.want) {
				t.Errorf("splitCSV(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func TestWatchCollectorErrors_CancelsOnPostReadyFailure(t *testing.T) {
	ch := make(chan error, 1)
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	canceled := make(chan struct{})
	cancel := func() { close(canceled) }

	ch <- errors.New("boom")
	close(ch)

	done := make(chan struct{})
	go func() {
		watchCollectorErrors(ch, cancel, logger)
		close(done)
	}()

	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("cancel was not called after a post-ready collector error")
	}
	<-done

	if !strings.Contains(buf.String(), "boom") {
		t.Errorf("log output = %q, want it to mention the collector error", buf.String())
	}
}

func TestWatchCollectorErrors_NoOpOnCleanShutdown(t *testing.T) {
	// col.Run returning nil (e.g. rt.shutdown() calling col.Shutdown()) closes
	// the channel without ever sending — that's expected daemon shutdown, not
	// a failure, so cancel must not be invoked again.
	ch := make(chan error)
	close(ch)

	canceled := false
	cancel := func() { canceled = true }

	done := make(chan struct{})
	go func() {
		watchCollectorErrors(ch, cancel, slog.Default())
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("watchCollectorErrors did not return on channel close")
	}

	if canceled {
		t.Error("cancel was called on a clean collector shutdown")
	}
}
