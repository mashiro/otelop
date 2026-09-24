package main

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/mashiro/otelop/internal/config"
	otelruntime "github.com/mashiro/otelop/internal/runtime"
	"github.com/urfave/cli/v3"
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

func TestConfigFlags_MatchConfigKeys(t *testing.T) {
	flags := configFlags(config.Defaults())
	byName := make(map[string]cli.Flag, len(flags))
	for _, flag := range flags {
		byName[flag.Names()[0]] = flag
	}
	var check func(reflect.Type, string)
	check = func(typ reflect.Type, prefix string) {
		for i := 0; i < typ.NumField(); i++ {
			field := typ.Field(i)
			key := prefix + field.Tag.Get("toml")
			if field.Type.Kind() == reflect.Struct {
				check(field.Type, key+".")
				continue
			}
			name := strings.NewReplacer(".", "-", "_", "-").Replace(key)
			flag, ok := byName[name]
			if !ok {
				t.Errorf("config key %s has no --%s flag", key, name)
				continue
			}
			wantEnv := "OTELOP_" + strings.ToUpper(strings.ReplaceAll(name, "-", "_"))
			envFlag, ok := flag.(interface{ GetEnvVars() []string })
			if !ok || !reflect.DeepEqual(envFlag.GetEnvVars(), []string{wantEnv}) {
				t.Errorf("--%s must use only %s", name, wantEnv)
			}
			delete(byName, name)
		}
	}
	check(reflect.TypeFor[config.Config](), "")
	for name := range byName {
		t.Errorf("flag --%s has no matching config key", name)
	}
}

func TestConfigFlags_RenamedOptionsPrecedence(t *testing.T) {
	cases := []struct {
		name, oldName, env, oldEnv, section, key string
		values                                   [3]string
		get                                      func(otelruntime.Options) string
	}{
		{"storage-retention", "retention", "OTELOP_STORAGE_RETENTION", "OTELOP_RETENTION", "storage", "retention", [3]string{"1d", "2d", "3d"}, func(o otelruntime.Options) string { return o.Retention }},
		{"storage-max-size", "max-size", "OTELOP_STORAGE_MAX_SIZE", "OTELOP_MAX_SIZE", "storage", "max_size", [3]string{"1GB", "2GB", "3GB"}, func(o otelruntime.Options) string { return o.MaxSize }},
		{"storage-memory-limit", "memory-limit", "OTELOP_STORAGE_MEMORY_LIMIT", "OTELOP_MEMORY_LIMIT", "storage", "memory_limit", [3]string{"128MB", "256MB", "384MB"}, func(o otelruntime.Options) string { return o.MemoryLimit }},
		{"ui-render-window-max", "render-window-max", "OTELOP_UI_RENDER_WINDOW_MAX", "OTELOP_RENDER_WINDOW_MAX", "ui", "render_window_max", [3]string{"100", "200", "300"}, func(o otelruntime.Options) string { return strconv.Itoa(o.RenderWindowMax) }},
		{"proxy-auth-headers", "proxy-header", "OTELOP_PROXY_AUTH_HEADERS", "OTELOP_PROXY_HEADERS", "proxy.auth.headers", "X-Test", [3]string{"file", "env", "cli"}, func(o otelruntime.Options) string { return o.ProxyAuth.Headers["X-Test"] }},
	}
	for _, tc := range cases {
		for _, commandName := range []string{"start", "info", "restart"} {
			t.Run(commandName+"/"+tc.name, func(t *testing.T) {
				path := filepath.Join(t.TempDir(), "config.toml")
				isolateInfoEnv(t, path)
				value := strconv.Quote(tc.values[0])
				if tc.section == "ui" {
					value = tc.values[0]
				}
				if err := os.WriteFile(path, []byte("["+tc.section+"]\n"+tc.key+" = "+value+"\n"), 0o600); err != nil {
					t.Fatal(err)
				}
				parse := func(args ...string) (otelruntime.Options, error) {
					app := newApp("test")
					app.Writer, app.ErrWriter = io.Discard, io.Discard
					var got otelruntime.Options
					for _, cmd := range app.Commands {
						if cmd.Name == commandName {
							cmd.Action = func(_ context.Context, parsed *cli.Command) error {
								got = runtimeOptionsFromCmd(parsed, "test")
								return nil
							}
						}
					}
					err := app.Run(context.Background(), append([]string{"otelop", commandName}, args...))
					return got, err
				}
				t.Setenv(tc.oldEnv, "obsolete")
				for i, source := range []string{"file", "env", "flag"} {
					var args []string
					if i == 1 {
						v := tc.values[i]
						if tc.name == "proxy-auth-headers" {
							v = "X-Test=" + v
						}
						t.Setenv(tc.env, v)
					}
					if i == 2 {
						v := tc.values[i]
						if tc.name == "proxy-auth-headers" {
							v = "X-Test=" + v
						}
						args = []string{"--" + tc.name, v}
						if tc.name == "proxy-auth-headers" {
							args = append(args, "--"+tc.name, "X-Other=other")
						}
					}
					got, err := parse(args...)
					if err != nil {
						t.Fatalf("%s: %v", source, err)
					}
					if actual := tc.get(got); actual != tc.values[i] {
						t.Errorf("%s: got %q, want %q", source, actual, tc.values[i])
					}
					if i == 2 && tc.name == "proxy-auth-headers" && got.ProxyAuth.Headers["X-Other"] != "other" {
						t.Error("repeated header was lost")
					}
				}
				if _, err := parse("--"+tc.oldName, tc.values[2]); err == nil {
					t.Errorf("obsolete --%s accepted", tc.oldName)
				}
			})
		}
	}
}
