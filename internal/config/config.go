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
	"strings"

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
	DefaultHTTPAddr      = ":4319"
	DefaultOTLPGRPCAddr  = "0.0.0.0:4317"
	DefaultOTLPHTTPAddr  = "0.0.0.0:4318"
	DefaultProxyURL      = ""
	DefaultProxyProtocol = ""
	DefaultTraceCap      = 1000
	DefaultMetricCap     = 3000
	DefaultLogCap        = 1000
	DefaultMaxDataPoints = 1000
	DefaultLogLevel      = "warn"
)

// Config is the on-disk shape of the TOML config file. Fields use snake_case
// keys to match TOML conventions (CLI flags are kebab-case, env vars are
// SCREAMING_SNAKE — pick whichever surface is most ergonomic).
type Config struct {
	HTTPAddr      string `toml:"http"`
	OTLPGRPCAddr  string `toml:"otlp_grpc"`
	OTLPHTTPAddr  string `toml:"otlp_http"`
	ProxyURL      string `toml:"proxy_url"`
	ProxyProtocol string `toml:"proxy_protocol"`
	TraceCap      int    `toml:"trace_cap"`
	MetricCap     int    `toml:"metric_cap"`
	LogCap        int    `toml:"log_cap"`
	MaxDataPoints int    `toml:"max_data_points"`
	LogLevel      string `toml:"log_level"`
	Debug         bool   `toml:"debug"`
}

// Defaults returns a Config populated with the built-in fallback values.
// Used as the starting point for Load — fields the file omits keep these
// values.
func Defaults() Config {
	return Config{
		HTTPAddr:      DefaultHTTPAddr,
		OTLPGRPCAddr:  DefaultOTLPGRPCAddr,
		OTLPHTTPAddr:  DefaultOTLPHTTPAddr,
		ProxyURL:      DefaultProxyURL,
		ProxyProtocol: DefaultProxyProtocol,
		TraceCap:      DefaultTraceCap,
		MetricCap:     DefaultMetricCap,
		LogCap:        DefaultLogCap,
		MaxDataPoints: DefaultMaxDataPoints,
		LogLevel:      DefaultLogLevel,
	}
}

// DefaultPath returns the path Load reads when no override is set. Honours
// OTELOP_CONFIG_FILE first, then $XDG_CONFIG_HOME/otelop/config.toml,
// falling back to ~/.config/otelop/config.toml on both macOS and Linux.
func DefaultPath() (string, error) {
	if p := os.Getenv(EnvConfigFile); p != "" {
		return p, nil
	}
	if dir := os.Getenv("XDG_CONFIG_HOME"); dir != "" {
		return filepath.Join(dir, configDir, configFilename), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home dir: %w", err)
	}
	return filepath.Join(home, ".config", configDir, configFilename), nil
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
