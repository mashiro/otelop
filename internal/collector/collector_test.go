package collector

import (
	"strings"
	"testing"
)

func TestBuildConfig_WithoutProxy(t *testing.T) {
	cfg := buildConfig(Config{
		GRPCEndpoint: "0.0.0.0:4317",
		HTTPEndpoint: "0.0.0.0:4318",
		LogLevel:     "warn",
	})
	if strings.Contains(cfg, "otlp_grpc/proxy") || strings.Contains(cfg, "otlphttp/proxy") {
		t.Fatalf("buildConfig unexpectedly included proxy exporter:\n%s", cfg)
	}
	if strings.Count(cfg, "exporters: [otelop]") != 3 {
		t.Fatalf("buildConfig should keep otelop-only pipelines:\n%s", cfg)
	}
}

func TestBuildConfig_WithGRPCProxy(t *testing.T) {
	cfg := buildConfig(Config{
		GRPCEndpoint:  "0.0.0.0:4317",
		HTTPEndpoint:  "0.0.0.0:4318",
		ProxyURL:      "http://upstream.example.com:4317",
		ProxyProtocol: "grpc",
		LogLevel:      "info",
	})
	if !strings.Contains(cfg, `otlp_grpc/proxy:`) {
		t.Fatalf("buildConfig missing grpc proxy exporter:\n%s", cfg)
	}
	if !strings.Contains(cfg, `endpoint: "upstream.example.com:4317"`) {
		t.Fatalf("buildConfig missing normalized grpc endpoint:\n%s", cfg)
	}
	if !strings.Contains(cfg, "insecure: true") {
		t.Fatalf("buildConfig missing insecure grpc tls config:\n%s", cfg)
	}
	if strings.Count(cfg, "exporters: [otelop, otlp_grpc/proxy]") != 3 {
		t.Fatalf("buildConfig should fan out all pipelines to grpc proxy:\n%s", cfg)
	}
}

func TestBuildConfig_WithHTTPProxy(t *testing.T) {
	cfg := buildConfig(Config{
		GRPCEndpoint:  "0.0.0.0:4317",
		HTTPEndpoint:  "0.0.0.0:4318",
		ProxyURL:      "http://upstream.example.com:4318",
		ProxyProtocol: "http",
		LogLevel:      "debug",
	})
	if !strings.Contains(cfg, `otlphttp/proxy:`) {
		t.Fatalf("buildConfig missing http proxy exporter:\n%s", cfg)
	}
	if !strings.Contains(cfg, `endpoint: "http://upstream.example.com:4318"`) {
		t.Fatalf("buildConfig missing http proxy endpoint:\n%s", cfg)
	}
	if strings.Count(cfg, "exporters: [otelop, otlphttp/proxy]") != 3 {
		t.Fatalf("buildConfig should fan out all pipelines to http proxy:\n%s", cfg)
	}
}
