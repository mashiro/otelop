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

// selfTelemetryIntervalMs is the periodic OTLP reader interval for the
// Collector's own component metrics. Mirrors the SDK-side cadence in
// internal/selftelemetry so both data sources tick together.
const selfTelemetryIntervalMs = 10_000

// Config holds runtime-configurable collector settings.
type Config struct {
	GRPCEndpoint  string
	HTTPEndpoint  string
	ProxyURL      string
	ProxyProtocol string
	ProxyHeaders  map[string]string
	LogLevel      string
	// SelfTelemetryEndpoint, when non-empty (host:port), makes the
	// Collector export its own component metrics
	// (otelcol_receiver_accepted_*, otelcol_exporter_sent_*, ...) via OTLP
	// gRPC to that endpoint. Empty disables self-telemetry and the default
	// Prometheus :8888 listener too.
	SelfTelemetryEndpoint string
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
		"logs":    obj{"level": cfg.LogLevel},
		"metrics": buildTelemetryMetricsConfig(cfg),
	}
}

// buildTelemetryMetricsConfig configures the Collector's self-telemetry. In
// both branches the Prometheus :8888 listener stays off — otelop never reads
// it and a second instance on the same host would collide. When an endpoint
// is provided, a periodic OTLP reader ships component metrics straight to
// otelop's own receiver instead.
func buildTelemetryMetricsConfig(cfg Config) obj {
	if cfg.SelfTelemetryEndpoint == "" {
		return obj{"level": "none"}
	}
	endpoint := (&url.URL{Scheme: "http", Host: cfg.SelfTelemetryEndpoint}).String()
	return obj{
		// "normal" omits per-RPC histograms that "detailed" enables; those
		// would dominate the bounded in-memory store at default capacity.
		"level": "normal",
		"readers": []any{
			obj{
				"periodic": obj{
					"interval": selfTelemetryIntervalMs,
					"exporter": obj{
						"otlp": obj{
							"protocol": "grpc",
							"endpoint": endpoint,
							"insecure": true,
						},
					},
				},
			},
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
		return &staticProvider{cfg: normalizeValue(cfg).(map[string]any)}
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

func normalizeValue(v any) any {
	switch x := v.(type) {
	case obj:
		out := make(map[string]any, len(x))
		for k, vv := range x {
			out[k] = normalizeValue(vv)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, vv := range x {
			out[k] = normalizeValue(vv)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, vv := range x {
			out[i] = normalizeValue(vv)
		}
		return out
	default:
		return v
	}
}
