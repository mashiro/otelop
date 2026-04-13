package collector

import (
	"fmt"
	"net/url"
	"strings"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/confmap/provider/yamlprovider"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/otelcol"
)

var version = "dev"

// Config holds runtime-configurable collector settings.
type Config struct {
	GRPCEndpoint  string
	HTTPEndpoint  string
	ProxyURL      string
	ProxyProtocol string
	LogLevel      string
}

func buildConfig(cfg Config) string {
	exporterConfig, pipelineExporters := buildProxyExporterConfig(cfg)

	return fmt.Sprintf(`
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: %q
      http:
        endpoint: %q
        cors:
          allowed_origins:
            - "*"

exporters:
  otelop: {}
%s

service:
  telemetry:
    logs:
      level: %q
    # Disable the Collector's own Prometheus self-metrics listener on :8888.
    # otelop doesn't consume it anywhere and the listener would conflict with
    # a second otelop instance on the same host.
    metrics:
      level: none
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [%s]
    metrics:
      receivers: [otlp]
      exporters: [%s]
    logs:
      receivers: [otlp]
      exporters: [%s]
`, cfg.GRPCEndpoint, cfg.HTTPEndpoint, exporterConfig, cfg.LogLevel, pipelineExporters, pipelineExporters, pipelineExporters)
}

func buildProxyExporterConfig(cfg Config) (string, string) {
	if cfg.ProxyURL == "" || cfg.ProxyProtocol == "" {
		return "", "otelop"
	}

	switch cfg.ProxyProtocol {
	case "grpc":
		endpoint, insecure := normalizeGRPCProxyURL(cfg.ProxyURL)
		tlsConfig := ""
		if insecure {
			tlsConfig = "\n    tls:\n      insecure: true"
		}
		return fmt.Sprintf("  otlp_grpc/proxy:\n    endpoint: %q%s", endpoint, tlsConfig), "otelop, otlp_grpc/proxy"
	case "http":
		return fmt.Sprintf("  otlphttp/proxy:\n    endpoint: %q", cfg.ProxyURL), "otelop, otlphttp/proxy"
	default:
		return "", "otelop"
	}
}

func normalizeGRPCProxyURL(raw string) (endpoint string, insecure bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" {
		return raw, true
	}
	switch strings.ToLower(u.Scheme) {
	case "http":
		return u.Host, true
	case "https":
		return u.Host, false
	default:
		return raw, true
	}
}

// New creates a new OTel Collector configured with an OTLP receiver
// and the otelop custom exporter.
func New(exporterFactory exporter.Factory, cfg Config) (*otelcol.Collector, error) {
	factories, err := components(exporterFactory)
	if err != nil {
		return nil, err
	}

	yamlConfig := buildConfig(cfg)

	set := otelcol.CollectorSettings{
		BuildInfo: component.BuildInfo{
			Command:     "otelop",
			Description: "Browser-based OpenTelemetry viewer",
			Version:     version,
		},
		Factories: func() (otelcol.Factories, error) {
			return factories, nil
		},
		ConfigProviderSettings: otelcol.ConfigProviderSettings{
			ResolverSettings: confmap.ResolverSettings{
				URIs: []string{"yaml:" + yamlConfig},
				ProviderFactories: []confmap.ProviderFactory{
					yamlprovider.NewFactory(),
				},
			},
		},
		DisableGracefulShutdown: true,
	}

	return otelcol.NewCollector(set)
}
