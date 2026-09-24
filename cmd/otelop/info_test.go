package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mashiro/otelop/internal/config"
)

// isolateInfoEnv points config.Load and storage-path resolution at
// throwaway temp locations so tests don't depend on (or pollute) the
// developer's machine.
func isolateInfoEnv(t *testing.T, cfgPath string) {
	t.Helper()
	clearConfigEnv(t)
	t.Setenv(config.EnvConfigFile, cfgPath)
	t.Setenv("XDG_DATA_HOME", filepath.Join(t.TempDir(), "xdg-data"))
}

func TestInfoCommand_ConfigOverrides(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.toml")
	dbPath := filepath.Join(dir, "otelop.duckdb")
	body := fmt.Sprintf(`
http = ":15000"
otlp_grpc = "0.0.0.0:15001"
otlp_http = "0.0.0.0:15002"
log_level = "debug"
debug = true

[proxy]
url = "https://upstream.example.com:4317"
protocol = "grpc"

[storage]
path = %q
retention = "24h"
max_size = "1GB"
memory_limit = "256MB"

[ui]
render_window_max = 250
`, dbPath)
	if err := os.WriteFile(cfgPath, []byte(body), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	isolateInfoEnv(t, cfgPath)

	stdout, _, err := runTestApp("info")
	if err != nil {
		t.Fatalf("run info: %v", err)
	}

	for _, want := range []string{
		cfgPath,
		"http://localhost:15000",
		"0.0.0.0:15001",
		"0.0.0.0:15002",
		"GRPC https://upstream.example.com:4317",
		"debug",
		"true",
		dbPath,
		"24h",
		"1GB",
		"256MB",
		"250",
	} {
		if !strings.Contains(stdout, want) {
			t.Errorf("output missing %q\noutput:\n%s", want, stdout)
		}
	}
	if strings.Contains(stdout, "not found") {
		t.Errorf("output should not mark the config file as not found:\n%s", stdout)
	}
}

func TestInfoCommand_ValidatesRenderWindowMax(t *testing.T) {
	dir := t.TempDir()
	isolateInfoEnv(t, filepath.Join(dir, "missing.toml"))

	_, _, err := runTestApp("info", "--ui-render-window-max", "0")
	if err == nil {
		t.Fatal("run info --ui-render-window-max 0: want error, got nil")
	}
	if !strings.Contains(err.Error(), "render-window-max") {
		t.Errorf("error %q should mention render-window-max", err.Error())
	}
}

func TestInfoCommand_ValidatesProxyAuth(t *testing.T) {
	dir := t.TempDir()
	isolateInfoEnv(t, filepath.Join(dir, "missing.toml"))

	_, _, err := runTestApp("info", "--proxy-auth-type", "bearer")
	if err == nil {
		t.Fatal("run info --proxy-auth-type bearer: want error, got nil")
	}
	if !strings.Contains(err.Error(), "proxy-url") {
		t.Errorf("error %q should mention proxy-url", err.Error())
	}
}

func TestInfoCommand_MissingConfigFile(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "missing.toml")
	isolateInfoEnv(t, missing)

	stdout, _, err := runTestApp("info")
	if err != nil {
		t.Fatalf("run info: %v", err)
	}

	if !strings.Contains(stdout, missing+" (not found)") {
		t.Errorf("output missing %q (not found) marker:\n%s", missing, stdout)
	}
	if !strings.Contains(stdout, config.DefaultOTLPGRPCAddr) {
		t.Errorf("output missing default otlp-grpc addr:\n%s", stdout)
	}
	if !strings.Contains(stdout, config.DefaultLogLevel) {
		t.Errorf("output missing default log level:\n%s", stdout)
	}
	if !strings.Contains(stdout, "(none)") {
		t.Errorf("output missing proxy (none):\n%s", stdout)
	}
	if strings.Contains(stdout, "DB size") {
		t.Errorf("output should not include database state:\n%s", stdout)
	}
}

func TestInfoCommand_EnvVarsOverrideConfigFile(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.toml")
	cfgStoragePath := filepath.Join(dir, "config.duckdb")
	body := fmt.Sprintf(`
http = ":14000"
otlp_grpc = "0.0.0.0:14001"
debug = false

[storage]
path = %q
retention = "1h"
max_size = "500MB"
memory_limit = "128MB"
`, cfgStoragePath)
	if err := os.WriteFile(cfgPath, []byte(body), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	isolateInfoEnv(t, cfgPath)

	envStoragePath := filepath.Join(dir, "env.duckdb")
	t.Setenv("OTELOP_HTTP", ":16000")
	t.Setenv("OTELOP_OTLP_GRPC", "0.0.0.0:16001")
	t.Setenv("OTELOP_DEBUG", "true")
	t.Setenv("OTELOP_STORAGE_PATH", envStoragePath)
	t.Setenv("OTELOP_STORAGE_RETENTION", "48h")
	t.Setenv("OTELOP_STORAGE_MAX_SIZE", "2GB")
	t.Setenv("OTELOP_STORAGE_MEMORY_LIMIT", "384MB")
	t.Setenv("OTELOP_LOG_LEVEL", "error")
	t.Setenv("OTELOP_PROXY_URL", "https://env-upstream.example.com:4318")
	t.Setenv("OTELOP_PROXY_PROTOCOL", "http")
	t.Setenv("OTELOP_UI_RENDER_WINDOW_MAX", "750")

	stdout, _, err := runTestApp("info")
	if err != nil {
		t.Fatalf("run info: %v", err)
	}

	for _, want := range []string{
		"http://localhost:16000",
		"0.0.0.0:16001",
		"true",
		envStoragePath,
		"48h",
		"2GB",
		"384MB",
		"error",
		"HTTP https://env-upstream.example.com:4318",
		"750",
	} {
		if !strings.Contains(stdout, want) {
			t.Errorf("output missing %q\noutput:\n%s", want, stdout)
		}
	}
	for _, unwanted := range []string{
		"http://localhost:14000",
		"0.0.0.0:14001",
		cfgStoragePath,
		"1h",
		"500MB",
		"128MB",
	} {
		if strings.Contains(stdout, unwanted) {
			t.Errorf("output should not show config-file value %q, env should win:\n%s", unwanted, stdout)
		}
	}
}
