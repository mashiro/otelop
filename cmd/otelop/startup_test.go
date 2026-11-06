package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
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
	t.Setenv("PATH", filepath.Dir(startupTestExecutable(t)))
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

func startupTestExecutable(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "otelop")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestStartupExecutableUsesPathOrder(t *testing.T) {
	first := startupTestExecutable(t)
	second := startupTestExecutable(t)
	link := filepath.Join(t.TempDir(), "otelop")
	if err := os.Symlink(first, link); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, first, second string }{
		{"executable", first, second},
		{"symlink", link, second},
		{"reordered", second, link},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("PATH", filepath.Dir(tc.first)+string(os.PathListSeparator)+filepath.Dir(tc.second))
			exe, err := startupExecutable("")
			if err != nil {
				t.Fatal(err)
			}
			if exe != tc.first {
				t.Fatalf("executable = %q, want %q", exe, tc.first)
			}
		})
	}
}

func TestStartupEnableExecutable(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("login startup requires macOS or Linux")
	}
	for _, name := range []string{"absolute", "relative", "symlink", "missing", "directory", "not-executable", "empty"} {
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			t.Setenv("HOME", home)
			t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, "config"))
			t.Setenv("OTELOP_CONFIG_FILE", filepath.Join(home, "config.toml"))
			bin := t.TempDir()
			if err := os.WriteFile(filepath.Join(bin, "systemctl"), []byte("#!/bin/sh\nexit 0\n"), 0o700); err != nil {
				t.Fatal(err)
			}
			// PATH auto-detection would pick the shim, so only an explicit path can win.
			selected, shim := startupTestInstall(t)
			t.Setenv("PATH", bin+string(os.PathListSeparator)+filepath.Dir(selected))
			t.Chdir(filepath.Dir(selected))
			arg, want := selected, selected
			valid := true
			switch name {
			case "relative":
				arg = "otelop"
				valid = false
			case "symlink":
				arg = filepath.Join(t.TempDir(), "custom launcher")
				if err := os.Symlink(selected, arg); err != nil {
					t.Fatal(err)
				}
				want = arg
			case "missing":
				arg = filepath.Join(home, "missing")
				valid = false
			case "directory":
				arg = home
				valid = false
			case "not-executable":
				if err := os.Chmod(selected, 0o600); err != nil {
					t.Fatal(err)
				}
				valid = false
			case "empty":
				arg = ""
				valid = false
			}
			r, err := startupRegistration()
			if err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Dir(r.Path), 0o700); err != nil {
				t.Fatal(err)
			}
			const existing = "existing registration"
			if err := os.WriteFile(r.Path, []byte(existing), 0o600); err != nil {
				t.Fatal(err)
			}
			stdout, _, err := runTestApp("startup", "enable", "--executable", arg)
			data, readErr := os.ReadFile(r.Path)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if !valid {
				if err == nil || !strings.Contains(err.Error(), "--executable") {
					t.Fatalf("error = %v, want executable option error", err)
				}
				if string(data) != existing {
					t.Fatalf("invalid option overwrote registration: %s", data)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(stdout, "Executable: "+want) {
				t.Fatalf("stdout = %q, want executable %q", stdout, want)
			}
			if !strings.Contains(string(data), want) {
				t.Fatalf("registration = %s, want path %q", data, want)
			}
			if strings.Contains(string(data), shim) {
				t.Fatalf("registration = %s, must not use shim %q", data, shim)
			}
		})
	}
}

func TestStartupDetectExecutable(t *testing.T) {
	for _, tt := range []struct {
		name  string
		setup func(t *testing.T, versioned, shim string) (self, want string)
	}{
		{"shim-via-path", func(t *testing.T, versioned, shim string) (string, string) {
			t.Setenv("PATH", filepath.Dir(versioned))
			return filepath.Join(t.TempDir(), "unrelated", "otelop"), shim
		}},
		{"shim-via-self", func(t *testing.T, versioned, shim string) (string, string) {
			t.Setenv("PATH", t.TempDir())
			return versioned, shim
		}},
		{"missing-shim", func(t *testing.T, versioned, shim string) (string, string) {
			t.Setenv("PATH", filepath.Dir(versioned))
			if err := os.Remove(shim); err != nil {
				t.Fatal(err)
			}
			return filepath.Join(t.TempDir(), "unrelated", "otelop"), versioned
		}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			versioned, shim := startupTestInstall(t)
			self, want := tt.setup(t, versioned, shim)
			got, err := detectExecutable(self)
			if err != nil || got != want {
				t.Fatalf("got %q, %v; want %q", got, err, want)
			}
		})
	}
}

func TestStartupDetectExecutableNotFound(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	self := filepath.Join(t.TempDir(), "unrelated", "otelop")
	if _, err := detectExecutable(self); !errors.Is(err, exec.ErrNotFound) {
		t.Fatalf("error = %v, want executable not found", err)
	}
}

func startupTestInstall(t *testing.T) (versioned, shim string) {
	t.Helper()
	root := t.TempDir()
	versioned = filepath.Join(root, "installs", "tool", "1", "otelop")
	shim = filepath.Join(root, "shims", "otelop")
	for _, path := range []string{versioned, shim} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	return versioned, shim
}
