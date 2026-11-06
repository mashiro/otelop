package startup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegistrationLifecycle(t *testing.T) {
	for _, platform := range []string{"darwin", "linux"} {
		t.Run(platform, func(t *testing.T) {
			home := t.TempDir()
			r, err := New(platform, home, filepath.Join(home, "config"))
			if err != nil {
				t.Fatal(err)
			}
			if enabled, err := r.Enabled(); err != nil || enabled {
				t.Fatalf("initial status: %v, %v", enabled, err)
			}
			exe := "/opt/My App/otelop"
			for range 2 {
				if err := r.Enable(exe); err != nil {
					t.Fatal(err)
				}
			}
			if enabled, err := r.Enabled(); err != nil || !enabled {
				t.Fatalf("enabled status: %v, %v", enabled, err)
			}
			data, err := os.ReadFile(r.Path)
			if err != nil {
				t.Fatal(err)
			}
			if platform == "darwin" {
				for _, want := range []string{"<string>/opt/My App/otelop</string>", "\t\t<key>AbandonProcessGroup</key>\n\t\t<true/>", "\t\t<key>RunAtLoad</key>\n\t\t<true/>"} {
					if !strings.Contains(string(data), want) {
						t.Errorf("missing %s in %s", want, data)
					}
				}
			} else {
				if !strings.Contains(string(data), `ExecStart="/opt/My App/otelop" start`) {
					t.Fatalf("unexpected unit: %s", data)
				}
				target, err := os.Readlink(r.linkPath())
				if err != nil || target != r.Path {
					t.Fatalf("enable link: %q, %v", target, err)
				}
			}
			for range 2 {
				if err := r.Disable(); err != nil {
					t.Fatal(err)
				}
			}
			if enabled, err := r.Enabled(); err != nil || enabled {
				t.Fatalf("disabled status: %v, %v", enabled, err)
			}
		})
	}
}

func TestSystemdEscaping(t *testing.T) {
	r, _ := New("linux", t.TempDir(), t.TempDir())
	err := r.Enable(`/opt/100%/$bin/otelop`)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(r.Path)
	for _, want := range []string{`ExecStart="/opt/100%%/$$bin/otelop" start`} {
		if !strings.Contains(string(data), want) {
			t.Errorf("missing %s in %s", want, data)
		}
	}
}

func TestRejectUnsupportedAndRelativePaths(t *testing.T) {
	if _, err := New("windows", "/home/test", ""); err == nil {
		t.Fatal("expected unsupported OS error")
	}
	r, _ := New("linux", t.TempDir(), t.TempDir())
	if err := r.Enable("otelop"); err == nil {
		t.Fatal("expected absolute executable error")
	}
}

func TestDoNotOverwriteForeignLink(t *testing.T) {
	r, _ := New("linux", t.TempDir(), t.TempDir())
	if err := os.MkdirAll(filepath.Dir(r.linkPath()), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/some/other.service", r.linkPath()); err != nil {
		t.Fatal(err)
	}
	if err := r.Enable("/opt/otelop"); err == nil {
		t.Fatal("expected conflicting link error")
	}
	if err := r.Disable(); err == nil {
		t.Fatal("expected conflicting link error")
	}
}

func TestRelativeSystemdLinkLifecycle(t *testing.T) {
	r, err := New("linux", t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	exe := "/opt/otelop"
	if err := r.Enable(exe); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(r.linkPath()); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join("..", filepath.Base(r.Path))
	if err := os.Symlink(target, r.linkPath()); err != nil {
		t.Fatal(err)
	}
	if enabled, err := r.Enabled(); err != nil || !enabled {
		t.Fatalf("relative link status: %v, %v", enabled, err)
	}
	if err := r.Enable(exe); err != nil {
		t.Fatal(err)
	}
	if got, err := os.Readlink(r.linkPath()); err != nil || got != target {
		t.Fatalf("existing link changed: %q, %v", got, err)
	}
	if err := r.Disable(); err != nil {
		t.Fatal(err)
	}
	if enabled, err := r.Enabled(); err != nil || enabled {
		t.Fatalf("disabled status: %v, %v", enabled, err)
	}
	if _, err := os.Lstat(r.linkPath()); !os.IsNotExist(err) {
		t.Fatalf("link remains: %v", err)
	}
}

func TestRejectForeignRelativeSystemdLink(t *testing.T) {
	r, err := New("linux", t.TempDir(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	exe := "/opt/otelop"
	if err := r.Enable(exe); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(r.linkPath()); err != nil {
		t.Fatal(err)
	}
	target := "../another.service"
	if err := os.Symlink(target, r.linkPath()); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Enabled(); err == nil {
		t.Fatal("expected status to reject foreign relative link")
	}
	if err := r.Enable(exe); err == nil {
		t.Fatal("expected enable to reject foreign relative link")
	}
	if err := r.Disable(); err == nil {
		t.Fatal("expected disable to reject foreign relative link")
	}
	if got, err := os.Readlink(r.linkPath()); err != nil || got != target {
		t.Fatalf("foreign link changed: %q, %v", got, err)
	}
}

func TestRegistrationUsesLoginContext(t *testing.T) {
	for _, platform := range []string{"darwin", "linux"} {
		t.Run(platform, func(t *testing.T) {
			r, err := New(platform, t.TempDir(), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Dir(r.Path), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(r.Path, []byte("WorkingDirectory=/deleted/project\nEnvironment=HOME=/old/home\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := r.Enable("/opt/otelop"); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(r.Path)
			if err != nil {
				t.Fatal(err)
			}
			for _, forbidden := range []string{"WorkingDirectory", "Environment"} {
				if strings.Contains(string(data), forbidden) {
					t.Fatalf("registration overrides login context: %s", data)
				}
			}
		})
	}
}

func TestLaunchAgentEscapesXML(t *testing.T) {
	r, err := New("darwin", t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Enable("/opt/a&b/otelop"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(r.Path)
	if err != nil {
		t.Fatal(err)
	}
	if want := "<string>/opt/a&amp;b/otelop</string>"; !strings.Contains(string(data), want) {
		t.Fatalf("missing %s in %s", want, data)
	}
}
