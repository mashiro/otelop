// Package startup manages per-user login registration without starting or stopping servers.
package startup

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const label = "io.github.mashiro.otelop"

// Options records the executable and path context used at the next login.
// Runtime settings remain in the existing TOML file, not in this registration.
type Options struct {
	Executable       string
	WorkingDirectory string
	Environment      map[string]string
}

type Registration struct {
	Path     string
	platform string
}

func New(platform, home, configHome string) (Registration, error) {
	if !filepath.IsAbs(home) {
		return Registration{}, errors.New("startup requires an absolute home directory")
	}
	switch platform {
	case "darwin":
		return Registration{Path: filepath.Join(home, "Library", "LaunchAgents", label+".plist"), platform: platform}, nil
	case "linux":
		if configHome == "" {
			configHome = filepath.Join(home, ".config")
		}
		if !filepath.IsAbs(configHome) {
			return Registration{}, errors.New("XDG_CONFIG_HOME must be absolute")
		}
		return Registration{Path: filepath.Join(configHome, "systemd", "user", "otelop-startup.service"), platform: platform}, nil
	default:
		return Registration{}, fmt.Errorf("startup is unsupported on %s (supported: macOS and Linux with systemd)", platform)
	}
}

func (r Registration) linkPath() string {
	return filepath.Join(filepath.Dir(r.Path), "default.target.wants", filepath.Base(r.Path))
}

func (r Registration) checkLink() (bool, error) {
	target, err := os.Readlink(r.linkPath())
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	resolved := target
	if !filepath.IsAbs(resolved) {
		resolved = filepath.Join(filepath.Dir(r.linkPath()), resolved)
	}
	if filepath.Clean(resolved) != filepath.Clean(r.Path) {
		return false, fmt.Errorf("startup link %s points to another unit: %s", r.linkPath(), target)
	}
	return true, nil
}

func (r Registration) Enabled() (bool, error) {
	info, err := os.Stat(r.Path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() {
		return false, fmt.Errorf("startup registration is not a regular file: %s", r.Path)
	}
	if r.platform == "linux" {
		return r.checkLink()
	}
	return true, nil
}

func (r Registration) Enable(opts Options) error {
	if !filepath.IsAbs(opts.Executable) || !filepath.IsAbs(opts.WorkingDirectory) {
		return errors.New("startup executable and working directory must be absolute")
	}
	// Reject control characters rather than emitting malformed launchd/systemd syntax.
	for _, value := range append([]string{opts.Executable, opts.WorkingDirectory}, environmentPairs(opts.Environment)...) {
		if strings.ContainsAny(value, "\x00\r\n") {
			return errors.New("startup paths and environment must not contain NUL or newlines")
		}
	}
	linked := false
	if r.platform == "linux" {
		var err error
		linked, err = r.checkLink()
		if err != nil {
			return err
		}
	}
	data, err := r.render(opts)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(r.Path), 0o700); err != nil {
		return err
	}
	// Rename a complete file so a failed write cannot truncate an existing registration.
	f, err := os.CreateTemp(filepath.Dir(r.Path), ".otelop-startup-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(f.Name()) }()
	if _, err := f.WriteString(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(f.Name(), r.Path); err != nil {
		return err
	}
	if r.platform == "linux" && !linked {
		if err := os.MkdirAll(filepath.Dir(r.linkPath()), 0o700); err != nil {
			return err
		}
		return os.Symlink(r.Path, r.linkPath())
	}
	return nil
}

func (r Registration) Disable() error {
	if r.platform == "linux" {
		linked, err := r.checkLink()
		if err != nil {
			return err
		}
		if linked {
			if err := os.Remove(r.linkPath()); err != nil {
				return err
			}
		}
	}
	err := os.Remove(r.Path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func environmentPairs(env map[string]string) []string {
	pairs := make([]string, 0, len(env))
	for k, v := range env {
		pairs = append(pairs, k+"="+v)
	}
	sort.Strings(pairs)
	return pairs
}
