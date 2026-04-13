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

	return map[string]any{
		"receivers": map[string]any{
			"otlp": map[string]any{
				"protocols": map[string]any{
					"grpc": map[string]any{
						"endpoint": cfg.GRPCEndpoint,
					},
					"http": map[string]any{
						"endpoint": cfg.HTTPEndpoint,
						"cors": map[string]any{
							"allowed_origins": []any{"*"},
						},
					},
				},
			},
		},
		"exporters": exporters,
		"service": map[string]any{
			"telemetry": map[string]any{
				"logs": map[string]any{
					"level": cfg.LogLevel,
				},
				// Disable the Collector's own Prometheus self-metrics listener on :8888.
				// otelop doesn't consume it anywhere and the listener would conflict with
				// a second otelop instance on the same host.
				"metrics": map[string]any{
					"level": "none",
				},
			},
			"pipelines": map[string]any{
				"traces":  buildPipelineConfig(pipelineExporters),
				"metrics": buildPipelineConfig(pipelineExporters),
				"logs":    buildPipelineConfig(pipelineExporters),
			},
		},
	}
}

func buildPipelineConfig(exporters []any) map[string]any {
	return map[string]any{
		"receivers": []any{"otlp"},
		"exporters": exporters,
	}
}

func buildProxyExporterConfig(cfg Config) (map[string]any, []any) {
	exporters := map[string]any{
		"otelop": map[string]any{},
	}
	pipelineExporters := []any{"otelop"}
	if cfg.ProxyURL == "" || cfg.ProxyProtocol == "" {
		return exporters, pipelineExporters
	}

	switch cfg.ProxyProtocol {
	case "grpc":
		endpoint, insecure := normalizeGRPCProxyURL(cfg.ProxyURL)
		exp := map[string]any{
			"endpoint": endpoint,
		}
		if insecure {
			exp["tls"] = map[string]any{"insecure": true}
		}
		if headers := renderHeaders(cfg.ProxyHeaders); len(headers) > 0 {
			exp["headers"] = headers
		}
		exporters["otlp_grpc/proxy"] = exp
		pipelineExporters = append(pipelineExporters, "otlp_grpc/proxy")
	case "http":
		exp := map[string]any{
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

func renderHeaders(headers map[string]string) map[string]any {
	if len(headers) == 0 {
		return nil
	}
	keys := make([]string, 0, len(headers))
	for k := range headers {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make(map[string]any, len(headers))
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

func newStaticProviderFactory(cfg map[string]any) confmap.ProviderFactory {
	return confmap.NewProviderFactory(func(confmap.ProviderSettings) confmap.Provider {
		return &staticProvider{cfg: cfg}
	})
}

type staticProvider struct {
	cfg map[string]any
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
