package startup

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveExecutableFollowsMiseUpgrade(t *testing.T) {
	home := t.TempDir()
	data := filepath.Join(home, "mise")
	shim := filepath.Join(data, "shims", "otelop")
	old := filepath.Join(data, "installs", "otelop", "1", "otelop")
	next := filepath.Join(data, "installs", "otelop", "2", "otelop")
	manager := filepath.Join(home, "bin", "mise")
	selected := filepath.Join(home, "selected")
	for _, file := range []string{shim, old, next, manager} {
		if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	for file, content := range map[string]string{old: "#!/bin/sh\necho old\n", next: "#!/bin/sh\necho new\n", manager: "#!/bin/sh\nif [ \"$1\" = which ]; then /bin/cat \"$HOME/selected\"; else exec \"$(/bin/cat \"$HOME/selected\")\" \"$@\"; fi\n"} {
		if err := os.WriteFile(file, []byte(content), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(manager, shim); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(selected, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	searchPath := filepath.Dir(old) // Activated mise puts versioned binaries before shims.
	env := map[string]string{"HOME": home, "MISE_DATA_DIR": data}
	got, err := ResolveExecutable(context.Background(), Options{Executable: old, WorkingDirectory: home, Environment: env}, searchPath)
	if err != nil {
		t.Fatal(err)
	}
	if got != shim {
		t.Fatalf("executable = %q, want shim %q", got, shim)
	}
	if err := os.WriteFile(selected, []byte(next), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(old); err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(context.Background(), got, "start")
	cmd.Env = []string{"HOME=" + home, "MISE_DATA_DIR=" + data}
	out, err := cmd.Output()
	if err != nil || strings.TrimSpace(string(out)) != "new" {
		t.Fatalf("after upgrade: %q, %v", out, err)
	}
	// A shim selecting another installation must not replace an explicit executable.
	got, err = ResolveExecutable(context.Background(), Options{Executable: manager, WorkingDirectory: home, Environment: env}, searchPath)
	if err != nil || got != manager {
		t.Fatalf("unrelated executable: %q, %v", got, err)
	}
}

func TestResolveExecutablePreservesSymlink(t *testing.T) {
	dir := t.TempDir()
	actual := filepath.Join(dir, "version", "otelop")
	stable := filepath.Join(dir, "bin", "otelop")
	for _, p := range []string{actual, stable} {
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(actual, []byte("binary"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(actual, stable); err != nil {
		t.Fatal(err)
	}
	got, err := ResolveExecutable(context.Background(), Options{Executable: actual, WorkingDirectory: dir, Environment: map[string]string{"HOME": dir}}, filepath.Dir(stable))
	if err != nil || got != stable {
		t.Fatalf("got %q, %v", got, err)
	}
}
