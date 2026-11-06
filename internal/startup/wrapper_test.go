package startup

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func newDarwin(t *testing.T) (Registration, string) {
	t.Helper()
	home := t.TempDir()
	dataHome := filepath.Join(home, "data")
	r, err := New("darwin", home, "", dataHome)
	if err != nil {
		t.Fatal(err)
	}
	return r, filepath.Join(dataHome, "otelop", "startup", "otelop")
}

func TestEnableWritesWrapper(t *testing.T) {
	r, wrapper := newDarwin(t)
	shim := "/opt/mise/shims/otelop"
	if err := r.Enable(shim); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(wrapper)
	if err != nil {
		t.Fatal(err)
	}
	if want := "#!/bin/sh\nexec '/opt/mise/shims/otelop' \"$@\"\n"; string(data) != want {
		t.Errorf("wrapper = %q, want %q", data, want)
	}
	info, _ := os.Stat(wrapper)
	if info.Mode().Perm() != 0o755 {
		t.Errorf("mode = %v", info.Mode().Perm())
	}
	plist, _ := os.ReadFile(r.Path)
	if !strings.Contains(string(plist), "<string>"+wrapper+"</string>\n\t\t\t<string>start</string>") {
		t.Errorf("plist does not point at wrapper: %s", plist)
	}
	if strings.Contains(string(plist), shim) {
		t.Errorf("plist must not reference shim: %s", plist)
	}
}

func TestWrapperQuotesPath(t *testing.T) {
	r, wrapper := newDarwin(t)
	if err := r.Enable("/opt/it's mine/shims/otelop"); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(wrapper)
	if want := `exec '/opt/it'\''s mine/shims/otelop' "$@"`; !strings.Contains(string(data), want) {
		t.Errorf("missing %s in %s", want, data)
	}
}

func TestWrapperExecsShimWithArgs(t *testing.T) {
	r, wrapper := newDarwin(t)
	dir := filepath.Join(t.TempDir(), "it's a dir", "shims")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	shim := filepath.Join(dir, "otelop")
	if err := os.WriteFile(shim, []byte("#!/bin/sh\nprintf '%s|' \"$@\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := r.Enable(shim); err != nil {
		t.Fatal(err)
	}
	out, err := exec.CommandContext(t.Context(), wrapper, "start", "a b").Output()
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != "start|a b|" {
		t.Errorf("output = %q", out)
	}
}

func TestEnableOnLinuxWritesNoWrapper(t *testing.T) {
	home := t.TempDir()
	dataHome := filepath.Join(home, "data")
	r, err := New("linux", home, filepath.Join(home, "config"), dataHome)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Enable("/opt/mise/shims/otelop"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dataHome); !os.IsNotExist(err) {
		t.Errorf("data home should be untouched: %v", err)
	}
	unit, _ := os.ReadFile(r.Path)
	if !strings.Contains(string(unit), `ExecStart="/opt/mise/shims/otelop" start`) {
		t.Errorf("unit = %s", unit)
	}
}

func TestDisableRemovesWrapperAndEmptyDir(t *testing.T) {
	r, wrapper := newDarwin(t)
	if err := r.Enable("/opt/mise/shims/otelop"); err != nil {
		t.Fatal(err)
	}
	if err := r.Disable(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Dir(wrapper)); !os.IsNotExist(err) {
		t.Errorf("startup dir remains: %v", err)
	}
}

func TestDisableKeepsNonEmptyWrapperDir(t *testing.T) {
	r, wrapper := newDarwin(t)
	if err := r.Enable("/opt/mise/shims/otelop"); err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(filepath.Dir(wrapper), "other")
	if err := os.WriteFile(other, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := r.Disable(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(wrapper); !os.IsNotExist(err) {
		t.Errorf("wrapper remains: %v", err)
	}
	if _, err := os.Stat(other); err != nil {
		t.Errorf("unrelated file removed: %v", err)
	}
}

func TestDisableWithoutWrapper(t *testing.T) {
	r, _ := newDarwin(t)
	if err := r.Disable(); err != nil {
		t.Fatal(err)
	}
}

func TestDataHomeDefaultsAndValidation(t *testing.T) {
	home := t.TempDir()
	r, err := New("darwin", home, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Enable("/opt/mise/shims/otelop"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, ".local", "share", "otelop", "startup", "otelop")); err != nil {
		t.Errorf("default wrapper location: %v", err)
	}
	if _, err := New("darwin", home, "", "relative/data"); err == nil {
		t.Fatal("expected error for relative XDG_DATA_HOME")
	}
}

func TestEnableNonShimUsesWrapper(t *testing.T) {
	r, wrapper := newDarwin(t)
	if err := r.Enable("/usr/local/bin/otelop"); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(wrapper)
	if want := "exec '/usr/local/bin/otelop' \"$@\""; !strings.Contains(string(data), want) {
		t.Errorf("missing %s in %s", want, data)
	}
}

func TestEnableReplacesWrapper(t *testing.T) {
	r, wrapper := newDarwin(t)
	for _, exe := range []string{"/opt/a/otelop", "/opt/b/otelop"} {
		if err := r.Enable(exe); err != nil {
			t.Fatal(err)
		}
	}
	data, _ := os.ReadFile(wrapper)
	if !strings.Contains(string(data), "'/opt/b/otelop'") || strings.Contains(string(data), "/opt/a/") {
		t.Errorf("wrapper not replaced: %s", data)
	}
}

func TestEnableRejectsWrapperAsExecutable(t *testing.T) {
	r, wrapper := newDarwin(t)
	if err := r.Enable(wrapper); err == nil {
		t.Fatal("expected error: the wrapper would exec itself")
	}
	if _, err := os.Stat(r.Path); !os.IsNotExist(err) {
		t.Errorf("registration must not be written: %v", err)
	}
}

func TestEnableCreatesPrivateDirectories(t *testing.T) {
	home := t.TempDir()
	dataHome := filepath.Join(home, "data")
	r, err := New("darwin", home, "", dataHome)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Enable("/opt/mise/shims/otelop"); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{filepath.Dir(r.Path), filepath.Join(dataHome, "otelop", "startup")} {
		info, err := os.Stat(dir)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o700 {
			t.Errorf("%s mode = %v, want 0700", dir, info.Mode().Perm())
		}
	}
}
