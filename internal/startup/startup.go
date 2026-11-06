// Package startup manages per-user login registration without starting or stopping servers.
package startup

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const label = "io.github.mashiro.otelop"

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

func (r Registration) Enable(executable string) error {
	if !filepath.IsAbs(executable) {
		return errors.New("startup executable must be absolute")
	}
	// Reject control characters rather than emitting malformed launchd/systemd syntax.
	if strings.ContainsAny(executable, "\x00\r\n") {
		return errors.New("startup executable must not contain NUL or newlines")
	}
	linked := false
	if r.platform == "linux" {
		var err error
		linked, err = r.checkLink()
		if err != nil {
			return err
		}
	}
	data, err := r.render(executable)
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
