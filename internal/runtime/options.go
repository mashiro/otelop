package runtime

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mashiro/otelop/internal/config"
)

type ProxyAuthOptions struct {
	Type     string
	Token    string
	Username string
	Password string
	Headers  map[string]string
}

type Options struct {
	Version         string
	HTTPAddr        string
	OTLPGRPCAddr    string
	OTLPHTTPAddr    string
	ProxyURL        string
	ProxyProtocol   string
	ProxyAuth       ProxyAuthOptions
	StoragePath     string
	Retention       string
	MaxSize         string
	RenderWindowMax int
	LogLevel        string
	Debug           bool
}

// Validate checks whether opts can be used to start an otelop runtime.
func Validate(opts Options) error {
	if opts.RenderWindowMax < 1 {
		return fmt.Errorf("render-window-max must be >= 1, got %d", opts.RenderWindowMax)
	}
	return validateProxyOptions(opts)
}

func validateProxyOptions(opts Options) error {
	if opts.ProxyURL == "" && opts.ProxyProtocol == "" {
		if opts.ProxyAuth.Type != "" || hasProxyAuthFields(opts.ProxyAuth) {
			return errors.New("proxy auth requires --proxy-url and --proxy-protocol")
		}
		return nil
	}
	if opts.ProxyURL == "" {
		return errors.New("proxy-protocol requires --proxy-url")
	}
	if opts.ProxyProtocol == "" {
		return errors.New("proxy-url requires --proxy-protocol (grpc|http)")
	}
	u, err := url.Parse(opts.ProxyURL)
	if err != nil {
		return fmt.Errorf("invalid proxy-url: %w", err)
	}
	if u.User != nil {
		return errors.New("proxy-url must not contain embedded credentials; use --proxy-auth-* instead")
	}
	if err := validateProxyAuth(opts.ProxyAuth); err != nil {
		return err
	}
	switch opts.ProxyProtocol {
	case "grpc":
		if err := validateGRPCProxyURL(u, opts.ProxyURL); err != nil {
			return err
		}
		return validateNoSelfProxy(u, opts.ProxyURL, opts.OTLPGRPCAddr, "grpc")
	case "http":
		if err := validateHTTPProxyURL(u, opts.ProxyURL); err != nil {
			return err
		}
		return validateNoSelfProxy(u, opts.ProxyURL, opts.OTLPHTTPAddr, "http")
	default:
		return fmt.Errorf("invalid proxy-protocol %q: want grpc or http", opts.ProxyProtocol)
	}
}

func validateGRPCProxyURL(u *url.URL, raw string) error {
	if u.Scheme == "" {
		if raw == "" || strings.Contains(raw, "/") {
			return fmt.Errorf("invalid proxy-url %q for grpc: want host:port or http(s)://host:port", raw)
		}
		return nil
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		if u.Host == "" {
			return fmt.Errorf("invalid proxy-url %q for grpc: missing host", raw)
		}
		return nil
	default:
		return fmt.Errorf("invalid proxy-url %q for grpc: unsupported scheme %q", raw, u.Scheme)
	}
}

func validateHTTPProxyURL(u *url.URL, raw string) error {
	if u.Scheme == "" || u.Host == "" {
		return fmt.Errorf("invalid proxy-url %q for http: want http://host:port or https://host:port", raw)
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		return nil
	default:
		return fmt.Errorf("invalid proxy-url %q for http: unsupported scheme %q", raw, u.Scheme)
	}
}

func validateProxyAuth(auth ProxyAuthOptions) error {
	switch auth.Type {
	case "":
		if hasProxyAuthFields(auth) {
			return errors.New("proxy auth fields require --proxy-auth-type")
		}
		return nil
	case "bearer":
		if auth.Token == "" {
			return errors.New("proxy-auth-type bearer requires --proxy-auth-token")
		}
		if auth.Username != "" || auth.Password != "" || len(auth.Headers) > 0 {
			return errors.New("proxy-auth-type bearer only supports --proxy-auth-token")
		}
	case "basic":
		if auth.Username == "" || auth.Password == "" {
			return errors.New("proxy-auth-type basic requires --proxy-auth-username and --proxy-auth-password")
		}
		if auth.Token != "" || len(auth.Headers) > 0 {
			return errors.New("proxy-auth-type basic only supports username/password")
		}
	case "headers":
		if len(auth.Headers) == 0 {
			return errors.New("proxy-auth-type headers requires at least one --proxy-header")
		}
		if auth.Token != "" || auth.Username != "" || auth.Password != "" {
			return errors.New("proxy-auth-type headers only supports --proxy-header")
		}
	default:
		return fmt.Errorf("invalid proxy-auth-type %q: want bearer, basic, or headers", auth.Type)
	}
	return nil
}

func validateNoSelfProxy(u *url.URL, proxyURL, listenAddr, protocol string) error {
	target, err := comparableProxyHostPort(u, proxyURL, protocol)
	if err != nil {
		return err
	}
	local, err := normalizeHostPort(listenAddr)
	if err != nil {
		return err
	}
	if target == local {
		return fmt.Errorf("proxy-url %q points back to otelop's own OTLP %s listener %q", proxyURL, protocol, listenAddr)
	}
	return nil
}

func comparableProxyHostPort(u *url.URL, proxyURL, protocol string) (string, error) {
	if protocol == "grpc" && u.Scheme == "" {
		return normalizeHostPort(proxyURL)
	}
	return normalizeHostPort(u.Host)
}

func normalizeHostPort(addr string) (string, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "", err
	}
	host = strings.ToLower(strings.Trim(host, "[]"))
	switch host {
	case "", "0.0.0.0", "::", "::1", "127.0.0.1", "localhost":
		host = "localhost"
	}
	return net.JoinHostPort(host, port), nil
}

func hasProxyAuthFields(auth ProxyAuthOptions) bool {
	return auth.Token != "" || auth.Username != "" || auth.Password != "" || len(auth.Headers) > 0
}

func buildProxyHeaders(auth ProxyAuthOptions) map[string]string {
	switch auth.Type {
	case "bearer":
		return map[string]string{"Authorization": "Bearer " + auth.Token}
	case "basic":
		token := base64.StdEncoding.EncodeToString([]byte(auth.Username + ":" + auth.Password))
		return map[string]string{"Authorization": "Basic " + token}
	case "headers":
		out := make(map[string]string, len(auth.Headers))
		for k, v := range auth.Headers {
			out[k] = v
		}
		return out
	default:
		return nil
	}
}

// ResolveStoragePath returns the configured DuckDB path or its XDG default.
func ResolveStoragePath(raw string) (string, error) {
	if raw != "" {
		return raw, nil
	}
	return config.DefaultStoragePath()
}

func resolveStorageOptions(opts Options) (path string, retention time.Duration, maxSize int64, err error) {
	path, err = ResolveStoragePath(opts.StoragePath)
	if err != nil {
		return "", 0, 0, fmt.Errorf("resolve storage path: %w", err)
	}
	if path != "" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return "", 0, 0, fmt.Errorf("create storage directory: %w", err)
		}
	}
	retention, err = config.ParseRetention(opts.Retention)
	if err != nil {
		return "", 0, 0, err
	}
	maxSize, err = config.ParseMaxSize(opts.MaxSize)
	if err != nil {
		return "", 0, 0, err
	}
	return path, retention, maxSize, nil
}

// RedactURL removes credentials before a proxy URL is persisted or displayed.
func RedactURL(raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.User == nil {
		return raw
	}
	u.User = url.UserPassword("REDACTED", "REDACTED")
	return u.String()
}
