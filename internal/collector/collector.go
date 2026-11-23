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
const (
	selfTelemetryIntervalMs      = 10_000
	selfTelemetryExportTimeoutMs = 1_000
)

// ProxyBatchConfig enables exporterhelper batching on the proxy exporter.
// Zero-valued fields are omitted so exporterhelper's defaults apply.
type ProxyBatchConfig struct {
	Enabled      bool
	FlushTimeout string
	Sizer        string
	MinSize      int64
	MaxSize      int64
}

// Config holds runtime-configurable collector settings.
type Config struct {
	GRPCEndpoint  string
	HTTPEndpoint  string
	ProxyURL      string
	ProxyProtocol string
	ProxyHeaders  map[string]string
	// ProxyMetricsTemporality "delta" routes upstream metrics through
	// cumulativetodelta; empty forwards them as received.
	ProxyMetricsTemporality string
	ProxyBatch              ProxyBatchConfig
	LogLevel                string
	// SelfTelemetryEndpoint, when non-empty (host:port), makes the
	// Collector export its own component metrics
	// (otelcol_receiver_accepted_*, otelcol_exporter_sent_*, ...) via OTLP
	// gRPC to that endpoint. Empty disables self-telemetry and the default
	// Prometheus :8888 listener too.
	SelfTelemetryEndpoint string
}

func buildConfigMap(cfg Config) map[string]any {
	exporters, proxyExporters := buildProxyExporterConfig(cfg)

	out := obj{
		"receivers": buildReceiversConfig(cfg),
		"exporters": exporters,
		"service": obj{
			"telemetry": buildTelemetryConfig(cfg),
			"pipelines": buildPipelinesConfig(cfg, proxyExporters),
		},
	}
	if convertsProxyMetricsToDelta(cfg, proxyExporters) {
		out["processors"] = obj{
			// Defaults are deliberate: initial_value=auto drops the first
			// point of counters that predate an otelop restart (their
			// cumulative total was already forwarded) and max_staleness=1h
			// bounds per-series state for long-running instances.
			"cumulativetodelta": obj{},
		}
	}
	return out
}

func convertsProxyMetricsToDelta(cfg Config, proxyExporters []any) bool {
	return cfg.ProxyMetricsTemporality == "delta" && len(proxyExporters) > 0
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

func buildPipelinesConfig(cfg Config, proxyExporters []any) obj {
	shared := append([]any{"otelop"}, proxyExporters...)
	pipelines := obj{
		"traces":  buildPipelineConfig(shared),
		"metrics": buildPipelineConfig(shared),
		"logs":    buildPipelineConfig(shared),
	}
	if convertsProxyMetricsToDelta(cfg, proxyExporters) {
		// Processors apply per pipeline, so the conversion gets its own
		// pipeline; the receiver fans out a copy and storage keeps the
		// temporality the app sent.
		pipelines["metrics"] = buildPipelineConfig([]any{"otelop"})
		upstream := buildPipelineConfig(proxyExporters)
		upstream["processors"] = []any{"cumulativetodelta"}
		pipelines["metrics/proxy"] = upstream
	}
	return pipelines
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
		// add high-volume self-telemetry without helping local investigation.
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
							"timeout":  selfTelemetryExportTimeoutMs,
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
	var proxyExporters []any
	if cfg.ProxyURL == "" || cfg.ProxyProtocol == "" {
		return exporters, proxyExporters
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
		if queue := proxySendingQueueConfig(cfg.ProxyBatch); queue != nil {
			exp["sending_queue"] = queue
		}
		exporters["otlp_grpc/proxy"] = exp
		proxyExporters = append(proxyExporters, "otlp_grpc/proxy")
	case "http":
		exp := obj{
			"endpoint": cfg.ProxyURL,
		}
		if headers := renderHeaders(cfg.ProxyHeaders); len(headers) > 0 {
			exp["headers"] = headers
		}
		if queue := proxySendingQueueConfig(cfg.ProxyBatch); queue != nil {
			exp["sending_queue"] = queue
		}
		exporters["otlphttp/proxy"] = exp
		proxyExporters = append(proxyExporters, "otlphttp/proxy")
	}
	return exporters, proxyExporters
}

// proxySendingQueueConfig turns on exporterhelper batching, which is off by
// default. Only the fields the user set are emitted; an empty batch section
// still enables batching with exporterhelper's own defaults.
func proxySendingQueueConfig(b ProxyBatchConfig) obj {
	if !b.Enabled {
		return nil
	}
	batch := obj{}
	if b.FlushTimeout != "" {
		batch["flush_timeout"] = b.FlushTimeout
	}
	if b.Sizer != "" {
		batch["sizer"] = b.Sizer
	}
	if b.MinSize != 0 {
		batch["min_size"] = b.MinSize
	}
	if b.MaxSize != 0 {
		batch["max_size"] = b.MaxSize
	}
	return obj{"batch": batch}
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
