package collector

import (
	"context"
	"net/url"
	"sort"
	"strings"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/otelcol"
)

var version = "dev"

type obj map[string]any

// Config holds runtime-configurable collector settings.
type Config struct {
	GRPCEndpoint  string
	HTTPEndpoint  string
	ProxyURL      string
	ProxyProtocol string
	ProxyHeaders  map[string]string
	LogLevel      string
}

func buildConfigMap(cfg Config) map[string]any {
	exporters, pipelineExporters := buildProxyExporterConfig(cfg)

	return obj{
		"receivers": buildReceiversConfig(cfg),
		"exporters": exporters,
		"service":   buildServiceConfig(cfg, pipelineExporters),
	}
}

func buildReceiversConfig(cfg Config) obj {
	return obj{
		"otlp": obj{
			"protocols": obj{
				"grpc": obj{
					"endpoint": cfg.GRPCEndpoint,
				},
				"http": obj{
					"endpoint": cfg.HTTPEndpoint,
					"cors": obj{
						"allowed_origins": []any{"*"},
					},
				},
			},
		},
	}
}

func buildServiceConfig(cfg Config, pipelineExporters []any) obj {
	return obj{
		"telemetry": buildTelemetryConfig(cfg),
		"pipelines": obj{
			"traces":  buildPipelineConfig(pipelineExporters),
			"metrics": buildPipelineConfig(pipelineExporters),
			"logs":    buildPipelineConfig(pipelineExporters),
		},
	}
}

func buildTelemetryConfig(cfg Config) obj {
	return obj{
		"logs": obj{
			"level": cfg.LogLevel,
		},
		// Disable the Collector's own Prometheus self-metrics listener on :8888.
		// otelop doesn't consume it anywhere and the listener would conflict with
		// a second otelop instance on the same host.
		"metrics": obj{
			"level": "none",
		},
	}
}

func buildPipelineConfig(exporters []any) obj {
	return obj{
		"receivers": []any{"otlp"},
		"exporters": exporters,
	}
}

func buildProxyExporterConfig(cfg Config) (obj, []any) {
	exporters := obj{
		"otelop": obj{},
	}
	pipelineExporters := []any{"otelop"}
	if cfg.ProxyURL == "" || cfg.ProxyProtocol == "" {
		return exporters, pipelineExporters
	}

	switch cfg.ProxyProtocol {
	case "grpc":
		endpoint, insecure := normalizeGRPCProxyURL(cfg.ProxyURL)
		exp := obj{
			"endpoint": endpoint,
		}
		if insecure {
			exp["tls"] = obj{"insecure": true}
		}
		if headers := renderHeaders(cfg.ProxyHeaders); len(headers) > 0 {
			exp["headers"] = headers
		}
		exporters["otlp_grpc/proxy"] = exp
		pipelineExporters = append(pipelineExporters, "otlp_grpc/proxy")
	case "http":
		exp := obj{
			"endpoint": cfg.ProxyURL,
		}
		if headers := renderHeaders(cfg.ProxyHeaders); len(headers) > 0 {
			exp["headers"] = headers
		}
		exporters["otlphttp/proxy"] = exp
		pipelineExporters = append(pipelineExporters, "otlphttp/proxy")
	}
	return exporters, pipelineExporters
}

func renderHeaders(headers map[string]string) obj {
	if len(headers) == 0 {
		return nil
	}
	keys := make([]string, 0, len(headers))
	for k := range headers {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make(obj, len(headers))
	for _, k := range keys {
		out[k] = headers[k]
	}
	return out
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

	providerFactory := newStaticProviderFactory(buildConfigMap(cfg))

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
				URIs: []string{"otelop:config"},
				ProviderFactories: []confmap.ProviderFactory{
					providerFactory,
				},
			},
		},
		DisableGracefulShutdown: true,
	}

	return otelcol.NewCollector(set)
}

func newStaticProviderFactory(cfg obj) confmap.ProviderFactory {
	return confmap.NewProviderFactory(func(confmap.ProviderSettings) confmap.Provider {
		return &staticProvider{cfg: cfg}
	})
}

type staticProvider struct {
	cfg obj
}

func (p *staticProvider) Retrieve(_ context.Context, _ string, _ confmap.WatcherFunc) (*confmap.Retrieved, error) {
	return confmap.NewRetrieved(p.cfg)
}

func (p *staticProvider) Scheme() string {
	return "otelop"
}

func (p *staticProvider) Shutdown(context.Context) error {
	return nil
}
