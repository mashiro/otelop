package config

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestDefaults_AppliedWhenFileMissing(t *testing.T) {
	t.Setenv(EnvConfigFile, filepath.Join(t.TempDir(), "missing.toml"))
	cfg, _, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.HTTPAddr != DefaultHTTPAddr {
		t.Errorf("HTTPAddr = %q, want %q", cfg.HTTPAddr, DefaultHTTPAddr)
	}
	if cfg.Storage.Retention != DefaultStorageRetention {
		t.Errorf("Storage.Retention = %q, want %q", cfg.Storage.Retention, DefaultStorageRetention)
	}
	if cfg.Storage.MaxSize != DefaultStorageMaxSize {
		t.Errorf("Storage.MaxSize = %q, want %q", cfg.Storage.MaxSize, DefaultStorageMaxSize)
	}
	if cfg.Storage.Path != "" {
		t.Errorf("Storage.Path = %q, want empty default", cfg.Storage.Path)
	}
	if cfg.LogLevel != DefaultLogLevel {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, DefaultLogLevel)
	}
	if len(cfg.AllowedHosts) != 0 {
		t.Errorf("AllowedHosts = %v, want empty default (strict Host checking)", cfg.AllowedHosts)
	}
}

// TestDefaultHTTPAddr_IsLoopback pins the literal value (not just equality
// with the constant) so a future edit can't silently widen the unauthenticated
// GraphQL/UI listener back to all interfaces the way ":4319" used to.
func TestDefaultHTTPAddr_IsLoopback(t *testing.T) {
	if DefaultHTTPAddr != "127.0.0.1:4319" {
		t.Errorf("DefaultHTTPAddr = %q, want a loopback-bound address (127.0.0.1:4319)", DefaultHTTPAddr)
	}
}

func TestLoad_MergesPartialFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	body := `
http = ":15000"
debug = true

[storage]
retention = "24h"
max_size = "1GB"
`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv(EnvConfigFile, path)

	cfg, gotPath, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if gotPath != path {
		t.Errorf("path = %q, want %q", gotPath, path)
	}
	if cfg.HTTPAddr != ":15000" {
		t.Errorf("HTTPAddr = %q, want :15000", cfg.HTTPAddr)
	}
	if cfg.Storage.Retention != "24h" {
		t.Errorf("Storage.Retention = %q, want 24h", cfg.Storage.Retention)
	}
	if cfg.Storage.MaxSize != "1GB" {
		t.Errorf("Storage.MaxSize = %q, want 1GB", cfg.Storage.MaxSize)
	}
	if !cfg.Debug {
		t.Errorf("Debug = false, want true")
	}
	// Untouched fields keep defaults.
	if cfg.OTLPGRPCAddr != DefaultOTLPGRPCAddr {
		t.Errorf("OTLPGRPCAddr = %q, want default %q", cfg.OTLPGRPCAddr, DefaultOTLPGRPCAddr)
	}
	if cfg.Proxy.URL != "" {
		t.Errorf("Proxy.URL = %q, want empty default", cfg.Proxy.URL)
	}
	if cfg.LogLevel != DefaultLogLevel {
		t.Errorf("LogLevel = %q, want default %q", cfg.LogLevel, DefaultLogLevel)
	}
}

func TestLoad_ProxySettings(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	body := `
[proxy]
url = "https://upstream.example.com:4317"
protocol = "grpc"

[proxy.auth]
type = "headers"

[proxy.auth.headers]
Authorization = "Bearer abc"
X-Api-Key = "secret"
`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv(EnvConfigFile, path)

	cfg, _, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Proxy.URL != "https://upstream.example.com:4317" {
		t.Errorf("Proxy.URL = %q", cfg.Proxy.URL)
	}
	if cfg.Proxy.Protocol != "grpc" {
		t.Errorf("Proxy.Protocol = %q", cfg.Proxy.Protocol)
	}
	if cfg.Proxy.Auth.Type != "headers" {
		t.Errorf("Proxy.Auth.Type = %q", cfg.Proxy.Auth.Type)
	}
	if got := cfg.Proxy.Auth.Headers["Authorization"]; got != "Bearer abc" {
		t.Errorf("Proxy.Auth.Headers[Authorization] = %q", got)
	}
}

func TestLoad_AllowedHosts(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	body := `
allowed_hosts = ["otelop.internal", "*.example.com"]
`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv(EnvConfigFile, path)

	cfg, _, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := []string{"otelop.internal", "*.example.com"}
	if !slices.Equal(cfg.AllowedHosts, want) {
		t.Errorf("AllowedHosts = %v, want %v", cfg.AllowedHosts, want)
	}
}

func TestLoad_UnknownKeyRejected(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	body := `
http = ":4319"
htttp = ":9999"  # typo
some_other = 42
`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv(EnvConfigFile, path)

	_, _, err := Load()
	if err == nil {
		t.Fatal("Load returned nil for config with unknown keys")
	}
	msg := err.Error()
	if !strings.Contains(msg, "unknown keys") {
		t.Errorf("error message = %q, want it to mention 'unknown keys'", msg)
	}
	if !strings.Contains(msg, "htttp") || !strings.Contains(msg, "some_other") {
		t.Errorf("error message = %q, want both unknown keys listed", msg)
	}
}

func TestLoad_ParseError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("not valid = = toml\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv(EnvConfigFile, path)

	_, _, err := Load()
	if err == nil {
		t.Fatal("Load returned nil error for invalid TOML")
	}
	if !strings.Contains(err.Error(), "parse") {
		t.Errorf("error message = %q, want it to mention 'parse'", err.Error())
	}
}

func TestDefaultPath_HonoursOverride(t *testing.T) {
	t.Setenv(EnvConfigFile, "/tmp/explicit.toml")
	got, err := DefaultPath()
	if err != nil {
		t.Fatalf("DefaultPath: %v", err)
	}
	if got != "/tmp/explicit.toml" {
		t.Errorf("DefaultPath = %q, want /tmp/explicit.toml", got)
	}
}

func TestParseRetention(t *testing.T) {
	tests := []struct {
		in      string
		want    time.Duration
		wantErr bool
	}{
		{in: "7d", want: 7 * 24 * time.Hour},
		{in: "1.5d", want: 36 * time.Hour},
		{in: "168h", want: 168 * time.Hour},
		{in: "24h30m", want: 24*time.Hour + 30*time.Minute},
		{in: "", wantErr: true},
		{in: "not-a-duration", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			got, err := ParseRetention(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("ParseRetention(%q) = %v, want error", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseRetention(%q): %v", tc.in, err)
			}
			if got != tc.want {
				t.Errorf("ParseRetention(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func TestParseMaxSize(t *testing.T) {
	tests := []struct {
		in      string
		want    int64
		wantErr bool
	}{
		{in: "4GB", want: 4_000_000_000},
		{in: "4GiB", want: 4 << 30},
		{in: "512MB", want: 512_000_000},
		{in: "512MiB", want: 512 << 20},
		{in: "10KB", want: 10_000},
		{in: "10KiB", want: 10 << 10},
		{in: "1024", want: 1024},
		{in: "", wantErr: true},
		{in: "not-a-size", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			got, err := ParseMaxSize(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("ParseMaxSize(%q) = %v, want error", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseMaxSize(%q): %v", tc.in, err)
			}
			if got != tc.want {
				t.Errorf("ParseMaxSize(%q) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}

func TestDefaultStoragePath_HonoursXDGDataHome(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", "/tmp/xdg-data")
	got, err := DefaultStoragePath()
	if err != nil {
		t.Fatalf("DefaultStoragePath: %v", err)
	}
	want := filepath.Join("/tmp/xdg-data", configDir, "otelop.duckdb")
	if got != want {
		t.Errorf("DefaultStoragePath = %q, want %q", got, want)
	}
}

func TestDefaultPath_HonoursXDG(t *testing.T) {
	t.Setenv(EnvConfigFile, "")
	t.Setenv("XDG_CONFIG_HOME", "/tmp/xdg")
	got, err := DefaultPath()
	if err != nil {
		t.Fatalf("DefaultPath: %v", err)
	}
	want := filepath.Join("/tmp/xdg", configDir, configFilename)
	if got != want {
		t.Errorf("DefaultPath = %q, want %q", got, want)
	}
}
