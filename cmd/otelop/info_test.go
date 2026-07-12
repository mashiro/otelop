package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mashiro/otelop/internal/config"
)

func TestPrintInfoResolved_ConfigOverrides(t *testing.T) {
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
`, dbPath)
	if err := os.WriteFile(cfgPath, []byte(body), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv(config.EnvConfigFile, cfgPath)

	var buf bytes.Buffer
	if err := printInfoResolved(&buf); err != nil {
		t.Fatalf("printInfoResolved: %v", err)
	}
	out := buf.String()

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
	} {
		if !strings.Contains(out, want) {
			t.Errorf("output missing %q\noutput:\n%s", want, out)
		}
	}
	if strings.Contains(out, "not found") {
		t.Errorf("output should not mark the config file as not found:\n%s", out)
	}
}

func TestPrintInfoResolved_MissingConfigFile(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "missing.toml")
	t.Setenv(config.EnvConfigFile, missing)
	// Point storage resolution at an empty temp dir so the default DB path
	// is guaranteed not to exist, independent of the machine running the test.
	t.Setenv("XDG_DATA_HOME", filepath.Join(dir, "xdg-data"))

	var buf bytes.Buffer
	if err := printInfoResolved(&buf); err != nil {
		t.Fatalf("printInfoResolved: %v", err)
	}
	out := buf.String()

	if !strings.Contains(out, missing+" (not found)") {
		t.Errorf("output missing %q (not found) marker:\n%s", missing, out)
	}
	if !strings.Contains(out, config.DefaultOTLPGRPCAddr) {
		t.Errorf("output missing default otlp-grpc addr:\n%s", out)
	}
	if !strings.Contains(out, config.DefaultLogLevel) {
		t.Errorf("output missing default log level:\n%s", out)
	}
	if !strings.Contains(out, "(none)") {
		t.Errorf("output missing proxy (none):\n%s", out)
	}
	if strings.Contains(out, "DB size") {
		t.Errorf("output should not include database state:\n%s", out)
	}
}
