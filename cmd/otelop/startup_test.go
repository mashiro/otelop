package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/urfave/cli/v3"
)

func TestStartupSubcommands(t *testing.T) {
	for _, tt := range []struct {
		name  string
		usage string
		new   func() *cli.Command
	}{
		{"enable", "Enable startup at the next login", startupEnableCommand},
		{"disable", "Disable startup at future logins", startupDisableCommand},
		{"status", "Show whether login startup is configured", startupStatusCommand},
	} {
		t.Run(tt.name, func(t *testing.T) {
			// Help and argument validation must work before reading the environment.
			t.Setenv("HOME", "")
			var out bytes.Buffer
			cmd := tt.new()
			cmd.Writer = &out
			if err := cmd.Run(context.Background(), []string{tt.name, "--help"}); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(out.String(), tt.usage) {
				t.Fatalf("help = %q, want %q", out.String(), tt.usage)
			}
			_, _, err := runTestApp("startup", tt.name, "unexpected")
			want := "startup " + tt.name + " accepts no arguments"
			if err == nil || err.Error() != want {
				t.Fatalf("error = %v, want %q", err, want)
			}
		})
	}
}

func TestStartupCommandLifecycle(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("CLI lifecycle uses macOS registration; both platforms are tested in internal/startup")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, "config"))
	t.Setenv("OTELOP_CONFIG_FILE", filepath.Join(home, "config.toml"))
	for _, step := range []struct{ action, want string }{{"status", "disabled"}, {"enable", "enabled"}, {"status", "enabled"}, {"disable", "disabled"}, {"status", "disabled"}} {
		stdout, _, err := runTestApp("startup", step.action)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(stdout, step.want) {
			t.Fatalf("%s: %q", step.action, stdout)
		}
	}
}

func TestStartupOptionsPreservePathsOnly(t *testing.T) {
	home := t.TempDir()
	t.Setenv("OTELOP_CONFIG_FILE", filepath.Join(home, "config.toml"))
	t.Setenv("OTELOP_STATE_DIR", "relative-state")
	t.Setenv("OTELOP_PROXY_AUTH_TOKEN", "do-not-copy")
	opts, err := startupOptions()
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(opts.Executable) || !filepath.IsAbs(opts.Environment["OTELOP_STATE_DIR"]) {
		t.Fatalf("paths must be absolute: %+v", opts)
	}
	if _, ok := opts.Environment["OTELOP_PROXY_AUTH_TOKEN"]; ok {
		t.Fatal("copied runtime credentials")
	}
}

func TestStartupRejectsInvalidConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(path, []byte("unknown_setting = true"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OTELOP_CONFIG_FILE", path)
	if _, err := startupOptions(); err == nil {
		t.Fatal("expected config error")
	}
}
