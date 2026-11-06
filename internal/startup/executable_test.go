package startup

import (
	"os"
	"path/filepath"
	"testing"
)

func TestShimFor(t *testing.T) {
	write := func(t *testing.T, path string, mode os.FileMode) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"), mode); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		name  string
		setup func(t *testing.T, root string) (candidates []string, want string)
	}{
		{"install", func(t *testing.T, root string) ([]string, string) {
			shim := filepath.Join(root, "shims", "otelop")
			write(t, shim, 0o755)
			return []string{filepath.Join(root, "installs", "tool", "1.0", "otelop")}, shim
		}},
		{"nested", func(t *testing.T, root string) ([]string, string) {
			shim := filepath.Join(root, "shims", "otelop")
			write(t, shim, 0o755)
			return []string{filepath.Join(root, "installs", "tool", "1.0", "bin", "otelop")}, shim
		}},
		{"symlinked version dir", func(t *testing.T, root string) ([]string, string) {
			shim := filepath.Join(root, "shims", "otelop")
			write(t, shim, 0o755)
			write(t, filepath.Join(root, "installs", "tool", "1.0", "otelop"), 0o755)
			if err := os.Symlink("1.0", filepath.Join(root, "installs", "tool", "latest")); err != nil {
				t.Fatal(err)
			}
			return []string{filepath.Join(root, "installs", "tool", "latest", "otelop")}, shim
		}},
		{"missing shims dir", func(t *testing.T, root string) ([]string, string) {
			return []string{filepath.Join(root, "installs", "tool", "1.0", "otelop")}, ""
		}},
		{"shim not executable", func(t *testing.T, root string) ([]string, string) {
			write(t, filepath.Join(root, "shims", "otelop"), 0o644)
			return []string{filepath.Join(root, "installs", "tool", "1.0", "otelop")}, ""
		}},
		{"no installs component", func(t *testing.T, root string) ([]string, string) {
			write(t, filepath.Join(root, "shims", "otelop"), 0o755)
			return []string{filepath.Join(root, "bin", "otelop")}, ""
		}},
		{"outer installs only", func(t *testing.T, root string) ([]string, string) {
			shim := filepath.Join(root, "shims", "otelop")
			write(t, shim, 0o755)
			return []string{filepath.Join(root, "installs", "a", "installs", "otelop")}, shim
		}},
		{"inner installs only", func(t *testing.T, root string) ([]string, string) {
			shim := filepath.Join(root, "installs", "a", "shims", "otelop")
			write(t, shim, 0o755)
			return []string{filepath.Join(root, "installs", "a", "installs", "otelop")}, shim
		}},
		{"second candidate", func(t *testing.T, root string) ([]string, string) {
			shim := filepath.Join(root, "shims", "otelop")
			write(t, shim, 0o755)
			return []string{filepath.Join(root, "bin", "otelop"), filepath.Join(root, "installs", "t", "1", "otelop")}, shim
		}},
		{"empty and relative candidates", func(t *testing.T, root string) ([]string, string) {
			write(t, filepath.Join(root, "shims", "otelop"), 0o755)
			t.Chdir(root)
			return []string{"", filepath.Join("installs", "t", "otelop")}, ""
		}},
		{"base name", func(t *testing.T, root string) ([]string, string) {
			shim := filepath.Join(root, "shims", "other")
			write(t, shim, 0o755)
			return []string{filepath.Join(root, "installs", "t", "1", "other")}, shim
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			candidates, want := tc.setup(t, root)
			if got := ShimFor(candidates); got != want {
				t.Fatalf("ShimFor(%q) = %q, want %q", candidates, got, want)
			}
		})
	}
}
