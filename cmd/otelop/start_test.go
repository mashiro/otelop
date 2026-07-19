package main

import (
	"slices"
	"strings"
	"testing"
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
