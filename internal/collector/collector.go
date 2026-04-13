package collector

import (
	"fmt"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/confmap/provider/yamlprovider"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/otelcol"
)

var version = "dev"

// Config holds runtime-configurable collector settings.
type Config struct {
	GRPCEndpoint string
	HTTPEndpoint string
	LogLevel     string
}

func buildConfig(cfg Config) string {
	return fmt.Sprintf(`
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: %s
      http:
        endpoint: %s
        cors:
          allowed_origins:
            - "*"

exporters:
  otelop: {}

service:
  telemetry:
    logs:
      level: %s
    # Disable the Collector's own Prometheus self-metrics listener on :8888.
    # otelop doesn't consume it anywhere and the listener would conflict with
    # a second otelop instance on the same host.
    metrics:
      level: none
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otelop]
    metrics:
      receivers: [otlp]
      exporters: [otelop]
    logs:
      receivers: [otlp]
      exporters: [otelop]
`, cfg.GRPCEndpoint, cfg.HTTPEndpoint, cfg.LogLevel)
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
