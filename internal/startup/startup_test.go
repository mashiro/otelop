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
			opts := Options{Executable: "/opt/My App/otelop", WorkingDirectory: home, Environment: map[string]string{"OTELOP_CONFIG_FILE": "/tmp/a&b.toml"}}
			for range 2 {
				if err := r.Enable(opts); err != nil {
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
				for _, want := range []string{"<string>/opt/My App/otelop</string>", "a&amp;b.toml", "\t\t<key>AbandonProcessGroup</key>\n\t\t<true/>", "\t\t<key>RunAtLoad</key>\n\t\t<true/>"} {
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
	err := r.Enable(Options{Executable: `/opt/100%/$bin/otelop`, WorkingDirectory: "/tmp", Environment: map[string]string{"OTELOP_CONFIG_FILE": "/tmp/50%.toml"}})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(r.Path)
	for _, want := range []string{`ExecStart="/opt/100%%/$$bin/otelop" start`, `Environment="OTELOP_CONFIG_FILE=/tmp/50%%.toml"`} {
		if !strings.Contains(string(data), want) {
			t.Errorf("missing %s in %s", want, data)
		}
	}
}

func TestSystemdWorkingDirectory(t *testing.T) {
	for _, tc := range []struct {
		path string
		want string
	}{
		{path: "/home/user", want: "/home/user"},
		{path: "/home/My Project", want: "/home/My Project"},
		{path: `/home/100%/$data/"project"`, want: `/home/100%%/$data/"project"`},
		{path: `/home/back\slash/project`, want: `/home/back\slash/project`},
	} {
		t.Run(tc.path, func(t *testing.T) {
			r, err := New("linux", t.TempDir(), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if err := r.Enable(Options{Executable: "/opt/otelop", WorkingDirectory: tc.path}); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(r.Path)
			if err != nil {
				t.Fatal(err)
			}
			for line := range strings.SplitSeq(string(data), "\n") {
				if value, ok := strings.CutPrefix(line, "WorkingDirectory="); ok {
					if value != tc.want {
						t.Fatalf("WorkingDirectory = %q, want %q", value, tc.want)
					}
					return
				}
			}
			t.Fatal("missing WorkingDirectory")
		})
	}
}

func TestRejectUnsupportedAndRelativePaths(t *testing.T) {
	if _, err := New("windows", "/home/test", ""); err == nil {
		t.Fatal("expected unsupported OS error")
	}
	r, _ := New("linux", t.TempDir(), t.TempDir())
	if err := r.Enable(Options{Executable: "otelop", WorkingDirectory: "/tmp"}); err == nil {
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
	if err := r.Enable(Options{Executable: "/opt/otelop", WorkingDirectory: "/tmp"}); err == nil {
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
	opts := Options{Executable: "/opt/otelop", WorkingDirectory: "/tmp"}
	if err := r.Enable(opts); err != nil {
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
	if err := r.Enable(opts); err != nil {
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
	opts := Options{Executable: "/opt/otelop", WorkingDirectory: "/tmp"}
	if err := r.Enable(opts); err != nil {
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
	if err := r.Enable(opts); err == nil {
		t.Fatal("expected enable to reject foreign relative link")
	}
	if err := r.Disable(); err == nil {
		t.Fatal("expected disable to reject foreign relative link")
	}
	if got, err := os.Readlink(r.linkPath()); err != nil || got != target {
		t.Fatalf("foreign link changed: %q, %v", got, err)
	}
}
