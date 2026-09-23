package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/mashiro/otelop/internal/config"
)

// clearConfigEnv unsets every OTELOP_* env var configFlags reads for the
// duration of the test, so a developer's shell can't leak into assertions.
// t.Setenv(name, "") isn't enough: cli v3 resolves env sources via
// os.LookupEnv, so an empty value still counts as set and overrides the
// config-file default.
func clearConfigEnv(t *testing.T) {
	t.Helper()
	for _, name := range configEnvNames() {
		original, wasSet := os.LookupEnv(name)
		if err := os.Unsetenv(name); err != nil {
			t.Fatalf("unset %s: %v", name, err)
		}
		t.Cleanup(func() {
			if wasSet {
				_ = os.Setenv(name, original)
			}
		})
	}
}

func configEnvNames() []string {
	var names []string
	for _, f := range configFlags(config.Defaults()) {
		if ef, ok := f.(interface{ GetEnvVars() []string }); ok {
			names = append(names, ef.GetEnvVars()...)
		}
	}
	return names
}

func TestParseHeaderArgs_HeaderPairsRoundTrip(t *testing.T) {
	headers := map[string]string{
		"X-Api-Key":     "secret",
		"X-Tenant-Id":   "acme",
		"Authorization": "Bearer token",
	}

	pairs := headerPairs(headers)
	got := parseHeaderArgs(pairs)

	if !reflect.DeepEqual(got, headers) {
		t.Errorf("round-trip mismatch:\n got:  %#v\n want: %#v", got, headers)
	}
}

func TestHeaderPairs_SortedAndEmpty(t *testing.T) {
	if got := headerPairs(nil); len(got) != 0 {
		t.Errorf("headerPairs(nil) = %#v, want empty", got)
	}

	pairs := headerPairs(map[string]string{"b": "2", "a": "1", "c": "3"})
	want := []string{"a=1", "b=2", "c=3"}
	if !reflect.DeepEqual(pairs, want) {
		t.Errorf("headerPairs sort order = %#v, want %#v", pairs, want)
	}
}

func TestParseHeaderArgs_SkipsMalformedAndBlank(t *testing.T) {
	got := parseHeaderArgs([]string{"noequalsign", " = blankkey", "X-Ok = value ", ""})
	want := map[string]string{"X-Ok": "value"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("parseHeaderArgs = %#v, want %#v", got, want)
	}

	if got := parseHeaderArgs(nil); got != nil {
		t.Errorf("parseHeaderArgs(nil) = %#v, want nil", got)
	}
}

// TestConfigFlags_FlagBeatsEnv exercises configFlags' precedence (CLI flag
// over env var) end-to-end through `info`, since cli.Command only resolves
// flag sources once the command actually parses args.
func TestConfigFlags_FlagBeatsEnv(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.toml")
	isolateInfoEnv(t, cfgPath)

	t.Setenv("OTELOP_HTTP", ":15000")

	stdout, _, err := runTestApp("info", "--http", ":16000")
	if err != nil {
		t.Fatalf("run info: %v", err)
	}

	if !strings.Contains(stdout, "http://localhost:16000") {
		t.Errorf("output missing flag-provided value:\n%s", stdout)
	}
	if strings.Contains(stdout, "http://localhost:15000") {
		t.Errorf("output should not show the env value once a flag overrides it:\n%s", stdout)
	}
}
