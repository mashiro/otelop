package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
	if cfg.TraceCap != DefaultTraceCap {
		t.Errorf("TraceCap = %d, want %d", cfg.TraceCap, DefaultTraceCap)
	}
	if cfg.LogLevel != DefaultLogLevel {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, DefaultLogLevel)
	}
}

func TestLoad_MergesPartialFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	body := `
http = ":15000"
trace_cap = 42
debug = true
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
	if cfg.TraceCap != 42 {
		t.Errorf("TraceCap = %d, want 42", cfg.TraceCap)
	}
	if !cfg.Debug {
		t.Errorf("Debug = false, want true")
	}
	// Untouched fields keep defaults.
	if cfg.OTLPGRPCAddr != DefaultOTLPGRPCAddr {
		t.Errorf("OTLPGRPCAddr = %q, want default %q", cfg.OTLPGRPCAddr, DefaultOTLPGRPCAddr)
	}
	if cfg.Proxy.URL != DefaultProxyURL {
		t.Errorf("Proxy.URL = %q, want default %q", cfg.Proxy.URL, DefaultProxyURL)
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
