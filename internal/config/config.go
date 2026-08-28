// Package config loads the optional otelop TOML config file. The file
// supplies defaults for `otelop start` flags; CLI flags and environment
// variables still take precedence at the command layer.
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

const (
	// EnvConfigFile lets callers point Load at a non-default path. Used by
	// tests and by users who keep multiple otelop profiles.
	EnvConfigFile = "OTELOP_CONFIG_FILE"

	configFilename = "config.toml"
	configDir      = "otelop"
)

// Default values used when neither the config file nor environment override
// a given field. Mirrored as the built-in CLI flag defaults so the values
// stay visible in `otelop start --help`.
const (
	// DefaultHTTPAddr binds loopback-only: the Web UI/GraphQL endpoint
	// carries no auth, so exposing it to the LAN by default would let anyone
	// on the network read stored telemetry. OTLP receivers below stay on
	// 0.0.0.0 to match OTel convention; LAN exposure of the UI is opt-in via
	// --http/OTELOP_HTTP/config.
	DefaultHTTPAddr     = "127.0.0.1:4319"
	DefaultOTLPGRPCAddr = "0.0.0.0:4317"
	DefaultOTLPHTTPAddr = "0.0.0.0:4318"
	DefaultLogLevel     = "warn"

	// DefaultStorageRetention and DefaultStorageMaxSize are the storage
	// section's defaults, per docs/design/duckdb-storage.md. Both are
	// human-readable strings — ParseRetention/ParseMaxSize turn them into
	// the time.Duration/byte-count internal/storage.Options wants.
	DefaultStorageRetention = "7d"
	DefaultStorageMaxSize   = "4GB"

	// DefaultRenderWindowMax is the ui section's default: how many rows the
	// frontend's traces/metrics/logs tables mount at once (they render every
	// row directly, no virtualization library — see
	// frontend/src/hooks/use-render-window.ts). Surfaced to the frontend via
	// the GraphQL `config` query.
	DefaultRenderWindowMax = 500
)

type ProxyAuthConfig struct {
	Type     string            `toml:"type"`
	Token    string            `toml:"token"`
	Username string            `toml:"username"`
	Password string            `toml:"password"`
	Headers  map[string]string `toml:"headers"`
}

type ProxyConfig struct {
	URL      string          `toml:"url"`
	Protocol string          `toml:"protocol"`
	Auth     ProxyAuthConfig `toml:"auth"`
}

// StorageConfig is the `[storage]` TOML section (docs/design/duckdb-storage.md's
// "Configuration changes (breaking)"). Retention and MaxSize are kept as the
// raw human-readable strings the file/CLI/env surfaces all use — parse with
// ParseRetention/ParseMaxSize at the point they're needed as a
// time.Duration/byte count (internal/storage.Options).
type StorageConfig struct {
	// Path is the database file location. Empty means the XDG default
	// ($XDG_DATA_HOME/otelop/otelop.duckdb, falling back to
	// ~/.local/share/otelop/otelop.duckdb) — see DefaultStoragePath.
	Path string `toml:"path"`
	// Retention accepts a Go duration string ("168h") or a "<n>d" days
	// shorthand ("7d"); see ParseRetention.
	Retention string `toml:"retention"`
	// MaxSize accepts a human byte size ("4GB", "4GiB"); see ParseMaxSize.
	MaxSize string `toml:"max_size"`
}

// UIConfig is the `[ui]` TOML section: settings that shape frontend
// rendering behavior rather than storage/network configuration.
type UIConfig struct {
	// RenderWindowMax bounds how many rows the frontend mounts at once in
	// the traces/metrics/logs tables (frontend/src/hooks/use-render-window.ts).
	// Those tables render every row directly rather than virtualizing, so a
	// live buffer sitting at its cap (stores/telemetry.ts's traceCap/
	// metricCap/logCap) would otherwise mount thousands of <tr> elements in
	// one paint. Must be >= 1; validated at startup (cmd/otelop's
	// validateRenderWindowMax), not here, matching where retention/max-size
	// values are only parsed to their typed form on load and validated by
	// the command layer.
	RenderWindowMax int `toml:"render_window_max"`
}

// Config is the on-disk shape of the TOML config file. Fields use snake_case
// keys to match TOML conventions (CLI flags are kebab-case, env vars are
// SCREAMING_SNAKE — pick whichever surface is most ergonomic).
type Config struct {
	HTTPAddr     string        `toml:"http"`
	OTLPGRPCAddr string        `toml:"otlp_grpc"`
	OTLPHTTPAddr string        `toml:"otlp_http"`
	Proxy        ProxyConfig   `toml:"proxy"`
	Storage      StorageConfig `toml:"storage"`
	UI           UIConfig      `toml:"ui"`
	LogLevel     string        `toml:"log_level"`
	Debug        bool          `toml:"debug"`
}

// Defaults returns a Config populated with the built-in fallback values.
// Used as the starting point for Load — fields the file omits keep these
// values.
func Defaults() Config {
	return Config{
		HTTPAddr:     DefaultHTTPAddr,
		OTLPGRPCAddr: DefaultOTLPGRPCAddr,
		OTLPHTTPAddr: DefaultOTLPHTTPAddr,
		Storage: StorageConfig{
			Retention: DefaultStorageRetention,
			MaxSize:   DefaultStorageMaxSize,
		},
		UI: UIConfig{
			RenderWindowMax: DefaultRenderWindowMax,
		},
		LogLevel: DefaultLogLevel,
	}
}

// ParseRetention parses a retention string in either Go duration form
// ("168h", "24h30m") or a "<n>d" days shorthand ("7d", "1.5d") — time.ParseDuration
// itself has no notion of days.
func ParseRetention(s string) (time.Duration, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, errors.New("retention: empty value")
	}
	if days, ok := strings.CutSuffix(s, "d"); ok {
		n, err := strconv.ParseFloat(strings.TrimSpace(days), 64)
		if err != nil {
			return 0, fmt.Errorf("retention: invalid %q: %w", s, err)
		}
		return time.Duration(n * float64(24*time.Hour)), nil
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, fmt.Errorf("retention: invalid %q: %w", s, err)
	}
	return d, nil
}

// maxSizeUnits maps a case-normalized suffix to its byte multiplier. Checked
// in this order so "kib"/"mib"/"gib" are matched before the shorter
// "kb"/"mb"/"gb" (both would otherwise match a string ending in "b").
var maxSizeUnits = []struct {
	suffix     string
	multiplier float64
}{
	{"kib", 1 << 10},
	{"mib", 1 << 20},
	{"gib", 1 << 30},
	{"kb", 1_000},
	{"mb", 1_000_000},
	{"gb", 1_000_000_000},
	{"b", 1},
}

// ParseMaxSize parses a human disk-size string ("4GB", "4GiB", or a bare
// byte count) into a byte count.
func ParseMaxSize(s string) (int64, error) {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return 0, errors.New("max_size: empty value")
	}
	lower := strings.ToLower(trimmed)
	for _, u := range maxSizeUnits {
		if num, ok := strings.CutSuffix(lower, u.suffix); ok {
			n, err := strconv.ParseFloat(strings.TrimSpace(num), 64)
			if err != nil {
				return 0, fmt.Errorf("max_size: invalid %q: %w", s, err)
			}
			return int64(n * u.multiplier), nil
		}
	}
	n, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("max_size: invalid %q: %w", s, err)
	}
	return n, nil
}

// xdgPath resolves an XDG base-directory-style path: envVar (e.g.
// XDG_CONFIG_HOME) if set, joined with configDir and filename; otherwise the
// user's home directory, joined with homeParts (the env var's conventional
// fallback location, e.g. ".config" or ".local", "share"), configDir, and
// filename. Shared by DefaultPath and DefaultStoragePath, which differ only
// in which env var/fallback dir/filename they use.
func xdgPath(envVar, filename string, homeParts ...string) (string, error) {
	if dir := os.Getenv(envVar); dir != "" {
		return filepath.Join(dir, configDir, filename), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home dir: %w", err)
	}
	parts := append(append([]string{home}, homeParts...), configDir, filename)
	return filepath.Join(parts...), nil
}

// DefaultPath returns the path Load reads when no override is set. Honours
// OTELOP_CONFIG_FILE first, then $XDG_CONFIG_HOME/otelop/config.toml,
// falling back to ~/.config/otelop/config.toml on both macOS and Linux.
func DefaultPath() (string, error) {
	if p := os.Getenv(EnvConfigFile); p != "" {
		return p, nil
	}
	return xdgPath("XDG_CONFIG_HOME", configFilename, ".config")
}

// DefaultStoragePath returns the DuckDB file location used when neither the
// config file nor --storage-path override it: $XDG_DATA_HOME/otelop/otelop.duckdb,
// falling back to ~/.local/share/otelop/otelop.duckdb — the XDG data-home
// counterpart of DefaultPath's config-home resolution.
func DefaultStoragePath() (string, error) {
	return xdgPath("XDG_DATA_HOME", "otelop.duckdb", ".local", "share")
}

// Load reads the config file at the resolved default path and merges it
// onto Defaults(). A missing file is not an error — callers get the
// built-in defaults. Returns the path that was actually read so it can be
// surfaced in errors and `--help` output.
func Load() (Config, string, error) {
	path, err := DefaultPath()
	if err != nil {
		return Defaults(), "", err
	}
	cfg, err := loadFile(path)
	return cfg, path, err
}

func loadFile(path string) (Config, error) {
	cfg := Defaults()
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cfg, nil
		}
		return cfg, fmt.Errorf("read %s: %w", path, err)
	}
	// Decode into the already-defaulted struct so omitted keys keep their
	// fallback values without explicit handling per field.
	md, err := toml.Decode(string(data), &cfg)
	if err != nil {
		return Defaults(), fmt.Errorf("parse %s: %w", path, err)
	}
	// Refuse unknown keys so a typo (e.g. `htttp = ":4319"`) fails loudly
	// at startup instead of silently falling back to the default.
	if undecoded := md.Undecoded(); len(undecoded) > 0 {
		keys := make([]string, len(undecoded))
		for i, k := range undecoded {
			keys[i] = k.String()
		}
		sort.Strings(keys)
		return Defaults(), fmt.Errorf("%s: unknown keys: %s", path, strings.Join(keys, ", "))
	}
	return cfg, nil
}
