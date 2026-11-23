package runtime

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/mashiro/otelop/internal/collector"
	"github.com/mashiro/otelop/internal/config"
	otelopgraphql "github.com/mashiro/otelop/internal/graphql"
)

type ExporterAuthOptions struct {
	Type     string
	Token    string
	Username string
	Password string
	Headers  map[string]string
}

// ExporterBatchOptions mirrors config.ExporterBatchConfig; zero values defer
// to the Collector's defaults.
type ExporterBatchOptions struct {
	Enabled      bool
	FlushTimeout string
	Sizer        string
	MinSize      int64
	MaxSize      int64
}

type ExporterOptions struct {
	Name     string
	URL      string
	Protocol string
	// MetricsTemporality is "" (forward as received) or "delta".
	MetricsTemporality string
	Batch              ExporterBatchOptions
	Auth               ExporterAuthOptions
}

type Options struct {
	Version      string
	HTTPAddr     string
	OTLPGRPCAddr string
	OTLPHTTPAddr string
	// Exporters is sorted by name so every surface (Collector config,
	// banners, status) lists them in the same order.
	Exporters       []ExporterOptions
	StoragePath     string
	Retention       string
	MaxSize         string
	MemoryLimit     string
	RenderWindowMax int
	LogLevel        string
	Debug           bool
}

// ExportersFromConfig converts the `[exporters.*]` tables into options,
// sorted by name and with enum-like values normalized.
func ExportersFromConfig(exporters map[string]config.ExporterConfig) []ExporterOptions {
	if len(exporters) == 0 {
		return nil
	}
	names := make([]string, 0, len(exporters))
	for name := range exporters {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]ExporterOptions, 0, len(names))
	for _, name := range names {
		e := exporters[name]
		out = append(out, ExporterOptions{
			Name:               name,
			URL:                strings.TrimSpace(e.URL),
			Protocol:           normalizeEnum(e.Protocol),
			MetricsTemporality: normalizeEnum(e.MetricsTemporality),
			Batch: ExporterBatchOptions{
				Enabled:      e.Batch.Enabled,
				FlushTimeout: strings.TrimSpace(e.Batch.FlushTimeout),
				Sizer:        normalizeEnum(e.Batch.Sizer),
				MinSize:      e.Batch.MinSize,
				MaxSize:      e.Batch.MaxSize,
			},
			Auth: ExporterAuthOptions{
				Type:     normalizeEnum(e.Auth.Type),
				Token:    e.Auth.Token,
				Username: e.Auth.Username,
				Password: e.Auth.Password,
				Headers:  e.Auth.Headers,
			},
		})
	}
	return out
}

func normalizeEnum(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// Validate checks whether opts can be used to start an otelop runtime.
func Validate(opts Options) error {
	if opts.RenderWindowMax < 1 {
		return fmt.Errorf("ui-render-window-max must be >= 1, got %d", opts.RenderWindowMax)
	}
	for _, e := range opts.Exporters {
		if err := validateExporter(e, opts.OTLPGRPCAddr, opts.OTLPHTTPAddr); err != nil {
			return err
		}
	}
	return nil
}

// exporterNameRegexp is the TOML bare-key charset. The name becomes the
// Collector component ID suffix (otlp_http/<name>), where "/" and whitespace
// would be misparsed.
var exporterNameRegexp = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func validateExporter(e ExporterOptions, grpcAddr, httpAddr string) error {
	if !exporterNameRegexp.MatchString(e.Name) {
		return fmt.Errorf("exporters.%q: name may only contain letters, digits, '_' and '-'", e.Name)
	}
	if err := validateExporterSettings(e, grpcAddr, httpAddr); err != nil {
		return fmt.Errorf("exporters.%s: %w", e.Name, err)
	}
	return nil
}

func validateExporterSettings(e ExporterOptions, grpcAddr, httpAddr string) error {
	if e.URL == "" {
		return errors.New("url is required")
	}
	if e.Protocol == "" {
		return errors.New("protocol is required (grpc|http)")
	}
	switch e.MetricsTemporality {
	case "", "delta":
	default:
		return fmt.Errorf("invalid metrics_temporality %q: want delta or empty", e.MetricsTemporality)
	}
	if !e.Batch.Enabled && e.Batch != (ExporterBatchOptions{}) {
		return errors.New("batch settings require batch.enabled = true")
	}
	// The Collector expands ${...} only after otelop has used these values:
	// the URL is parsed for validation and basic credentials are
	// base64-encoded, which would hide the reference.
	if hasEnvReference(e.URL) {
		return errors.New("url cannot reference environment variables")
	}
	if hasEnvReference(e.Auth.Username) || hasEnvReference(e.Auth.Password) {
		return errors.New("auth.username and auth.password cannot reference environment variables; use auth.type bearer or headers")
	}
	if err := validateExporterAuth(e.Auth); err != nil {
		return err
	}
	switch e.Protocol {
	case "grpc":
		// url.Parse reads "host:port" as scheme "host", so the bare form
		// the gRPC exporter accepts is checked on its own.
		if !hasScheme(e.URL) {
			return validateGRPCHostPort(e.URL, grpcAddr)
		}
		u, err := parseExporterURL(e.URL)
		if err != nil {
			return err
		}
		if err := validateGRPCURL(u, e.URL); err != nil {
			return err
		}
		return validateNoSelfExport(urlHostPort(u), e.URL, grpcAddr, "grpc")
	case "http":
		u, err := parseExporterURL(e.URL)
		if err != nil {
			return err
		}
		if err := validateHTTPURL(u, e.URL); err != nil {
			return err
		}
		return validateNoSelfExport(urlHostPort(u), e.URL, httpAddr, "http")
	default:
		return fmt.Errorf("invalid protocol %q: want grpc or http", e.Protocol)
	}
}

func hasEnvReference(s string) bool {
	return strings.Contains(s, "${env:")
}

func hasScheme(raw string) bool {
	return strings.Contains(raw, "://")
}

var errEmbeddedCredentials = errors.New("url must not contain embedded credentials; use auth instead")

func parseExporterURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}
	if u.User != nil {
		return nil, errEmbeddedCredentials
	}
	return u, nil
}

func validateGRPCHostPort(raw, listenAddr string) error {
	if strings.Contains(raw, "@") {
		return errEmbeddedCredentials
	}
	host, port, err := net.SplitHostPort(raw)
	if err != nil || host == "" || port == "" || strings.Contains(raw, "/") {
		return fmt.Errorf("invalid url %q for grpc: want host:port or http(s)://host:port", raw)
	}
	return validateNoSelfExport(raw, raw, listenAddr, "grpc")
}

func validateGRPCURL(u *url.URL, raw string) error {
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		if u.Host == "" {
			return fmt.Errorf("invalid url %q for grpc: missing host", raw)
		}
		return nil
	default:
		return fmt.Errorf("invalid url %q for grpc: unsupported scheme %q", raw, u.Scheme)
	}
}

func validateHTTPURL(u *url.URL, raw string) error {
	if u.Scheme == "" || u.Host == "" {
		return fmt.Errorf("invalid url %q for http: want http://host:port or https://host:port", raw)
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		return nil
	default:
		return fmt.Errorf("invalid url %q for http: unsupported scheme %q", raw, u.Scheme)
	}
}

func validateExporterAuth(auth ExporterAuthOptions) error {
	switch auth.Type {
	case "":
		if hasExporterAuthFields(auth) {
			return errors.New("auth fields require auth.type")
		}
		return nil
	case "bearer":
		if auth.Token == "" {
			return errors.New("auth.type bearer requires auth.token")
		}
		if auth.Username != "" || auth.Password != "" || len(auth.Headers) > 0 {
			return errors.New("auth.type bearer only supports auth.token")
		}
	case "basic":
		if auth.Username == "" || auth.Password == "" {
			return errors.New("auth.type basic requires auth.username and auth.password")
		}
		if auth.Token != "" || len(auth.Headers) > 0 {
			return errors.New("auth.type basic only supports auth.username and auth.password")
		}
	case "headers":
		if len(auth.Headers) == 0 {
			return errors.New("auth.type headers requires auth.headers")
		}
		if auth.Token != "" || auth.Username != "" || auth.Password != "" {
			return errors.New("auth.type headers only supports auth.headers")
		}
	default:
		return fmt.Errorf("invalid auth.type %q: want bearer, basic, or headers", auth.Type)
	}
	return nil
}

func validateNoSelfExport(target, rawURL, listenAddr, protocol string) error {
	remote, err := normalizeHostPort(target)
	if err != nil {
		return err
	}
	local, err := normalizeHostPort(listenAddr)
	if err != nil {
		return err
	}
	if remote == local {
		return fmt.Errorf("url %q points back to otelop's own OTLP %s listener %q", rawURL, protocol, listenAddr)
	}
	return nil
}

func urlHostPort(u *url.URL) string {
	if u.Port() != "" {
		return u.Host
	}
	// SaaS intakes are usually published without a port; the exporters dial
	// the scheme's default, so compare against that.
	port := "80"
	if strings.EqualFold(u.Scheme, "https") {
		port = "443"
	}
	return net.JoinHostPort(u.Hostname(), port)
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

func hasExporterAuthFields(auth ExporterAuthOptions) bool {
	return auth.Token != "" || auth.Username != "" || auth.Password != "" || len(auth.Headers) > 0
}

func buildExporterHeaders(auth ExporterAuthOptions) map[string]string {
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

func collectorExporters(exporters []ExporterOptions) []collector.Exporter {
	if len(exporters) == 0 {
		return nil
	}
	out := make([]collector.Exporter, len(exporters))
	for i, e := range exporters {
		out[i] = collector.Exporter{
			Name:               e.Name,
			URL:                e.URL,
			Protocol:           e.Protocol,
			Headers:            buildExporterHeaders(e.Auth),
			MetricsTemporality: e.MetricsTemporality,
			Batch:              collector.BatchConfig(e.Batch),
		}
	}
	return out
}

func exporterInfos(exporters []ExporterOptions) []otelopgraphql.ExporterInfo {
	out := make([]otelopgraphql.ExporterInfo, len(exporters))
	for i, e := range exporters {
		out[i] = otelopgraphql.ExporterInfo{Name: e.Name, URL: RedactURL(e.URL), Protocol: e.Protocol}
	}
	return out
}

// ResolveStoragePath returns the configured DuckDB path or its XDG default.
func ResolveStoragePath(raw string) (string, error) {
	if raw != "" {
		return raw, nil
	}
	return config.DefaultStoragePath()
}

func resolveStorageOptions(opts Options) (path string, retention time.Duration, maxSize int64, memoryLimit int64, err error) {
	path, err = ResolveStoragePath(opts.StoragePath)
	if err != nil {
		return "", 0, 0, 0, fmt.Errorf("resolve storage path: %w", err)
	}
	if path != "" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return "", 0, 0, 0, fmt.Errorf("create storage directory: %w", err)
		}
	}
	retention, err = config.ParseRetention(opts.Retention)
	if err != nil {
		return "", 0, 0, 0, err
	}
	maxSize, err = config.ParseMaxSize(opts.MaxSize)
	if err != nil {
		return "", 0, 0, 0, err
	}
	memoryLimit, err = config.ParseMemoryLimit(opts.MemoryLimit)
	if err != nil {
		return "", 0, 0, 0, err
	}
	return path, retention, maxSize, memoryLimit, nil
}

// RedactURL removes credentials before an exporter URL is persisted or displayed.
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
