package runtime

import (
	"strings"
	"testing"
)

func TestResolveStorageOptions_ParsesMemoryLimit(t *testing.T) {
	dir := t.TempDir()
	path, retention, maxSize, memoryLimit, err := resolveStorageOptions(Options{
		StoragePath: dir + "/otelop.duckdb",
		Retention:   "7d",
		MaxSize:     "4GB",
		MemoryLimit: "256MB",
	})
	if err != nil {
		t.Fatalf("resolveStorageOptions: %v", err)
	}
	if path == "" {
		t.Errorf("path = %q, want non-empty", path)
	}
	if retention <= 0 {
		t.Errorf("retention = %v, want > 0", retention)
	}
	if maxSize != 4_000_000_000 {
		t.Errorf("maxSize = %d, want 4_000_000_000", maxSize)
	}
	if memoryLimit != 256_000_000 {
		t.Errorf("memoryLimit = %d, want 256_000_000", memoryLimit)
	}
}

func TestResolveStorageOptions_InvalidMemoryLimitErrors(t *testing.T) {
	_, _, _, _, err := resolveStorageOptions(Options{
		Retention:   "7d",
		MaxSize:     "4GB",
		MemoryLimit: "not-a-size",
	})
	if err == nil || !strings.Contains(err.Error(), "memory_limit") {
		t.Fatalf("resolveStorageOptions error = %v, want it to mention memory_limit", err)
	}
}

func TestValidateProxyOptionsRejectsSelfProxy(t *testing.T) {
	opts := Options{
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

func TestValidateProxyOptionsRejectsCredentialsInURL(t *testing.T) {
	opts := Options{
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

func TestValidateProxyOptionsBearerAuth(t *testing.T) {
	opts := Options{
		OTLPGRPCAddr:  "0.0.0.0:4317",
		OTLPHTTPAddr:  "0.0.0.0:4318",
		ProxyURL:      "https://collector.example.com:4318",
		ProxyProtocol: "http",
		ProxyAuth: ProxyAuthOptions{
			Type:  "bearer",
			Token: "token",
		},
	}
	if err := validateProxyOptions(opts); err != nil {
		t.Fatalf("validateProxyOptions: %v", err)
	}
}

func TestValidateRejectsInvalidRenderWindow(t *testing.T) {
	for _, v := range []int{0, -1, -500} {
		if err := Validate(Options{RenderWindowMax: v}); err == nil {
			t.Errorf("Validate(RenderWindowMax=%d) = nil, want error", v)
		}
	}
}

func TestBuildProxyHeaders(t *testing.T) {
	headers := buildProxyHeaders(ProxyAuthOptions{
		Type:     "basic",
		Username: "alice",
		Password: "secret",
	})
	if got := headers["Authorization"]; got != "Basic YWxpY2U6c2VjcmV0" {
		t.Fatalf("Authorization = %q", got)
	}
}

func TestRedactURL(t *testing.T) {
	got := RedactURL("https://user:pass@example.com:4318")
	if got != "https://REDACTED:REDACTED@example.com:4318" {
		t.Fatalf("RedactURL = %q", got)
	}
}
