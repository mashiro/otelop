package collector

import (
	"context"
	"net/url"
	"sort"
	"strings"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/confmap/provider/envprovider"
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

// BatchConfig enables exporterhelper batching on an upstream exporter.
// Zero-valued fields are omitted so exporterhelper's defaults apply.
type BatchConfig struct {
	Enabled      bool
	FlushTimeout string
	Sizer        string
	MinSize      int64
	MaxSize      int64
}

// Exporter is one upstream OTLP endpoint that receives a copy of every
// signal. Name becomes the component ID suffix (otlphttp/<name>).
type Exporter struct {
	Name     string
	URL      string
	Protocol string
	Headers  map[string]string
	// MetricsTemporality "delta" routes this exporter's metrics through
	// cumulativetodelta; empty forwards them as received.
	MetricsTemporality string
	Batch              BatchConfig
}

// Config holds runtime-configurable collector settings.
type Config struct {
	GRPCEndpoint string
	HTTPEndpoint string
	// Exporters keep their slice order in every pipeline.
	Exporters []Exporter
	LogLevel  string
	// SelfTelemetryEndpoint, when non-empty (host:port), makes the
	// Collector export its own component metrics
	// (otelcol_receiver_accepted_*, otelcol_exporter_sent_*, ...) via OTLP
	// gRPC to that endpoint. Empty disables self-telemetry and the default
	// Prometheus :8888 listener too.
	SelfTelemetryEndpoint string
}

// upstreamIDs splits the upstream exporter IDs by whether their metrics
// need delta conversion.
type upstreamIDs struct {
	all, cumulative, delta []any
}

func buildConfigMap(cfg Config) map[string]any {
	exporters, ids := buildExportersConfig(cfg.Exporters)

	out := obj{
		"receivers": buildReceiversConfig(cfg),
		"exporters": exporters,
		"service": obj{
			"telemetry": buildTelemetryConfig(cfg),
			"pipelines": buildPipelinesConfig(ids),
		},
	}
	if len(ids.delta) > 0 {
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

func buildPipelinesConfig(ids upstreamIDs) obj {
	withLocal := func(upstream []any) []any {
		return append([]any{"otelop"}, upstream...)
	}
	pipelines := obj{
		"traces":  buildPipelineConfig(withLocal(ids.all)),
		"metrics": buildPipelineConfig(withLocal(ids.cumulative)),
		"logs":    buildPipelineConfig(withLocal(ids.all)),
	}
	if len(ids.delta) > 0 {
		// Processors apply per pipeline, so the conversion gets its own
		// pipeline; the receiver fans out a copy and storage keeps the
		// temporality the app sent.
		delta := buildPipelineConfig(ids.delta)
		delta["processors"] = []any{"cumulativetodelta"}
		pipelines["metrics/delta"] = delta
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

func buildExportersConfig(upstream []Exporter) (obj, upstreamIDs) {
	exporters := obj{
		"otelop": obj{},
	}
	var ids upstreamIDs
	for _, e := range upstream {
		id, exp := buildUpstreamExporter(e)
		if id == "" {
			continue
		}
		exporters[id] = exp
		ids.all = append(ids.all, id)
		if e.MetricsTemporality == "delta" {
			ids.delta = append(ids.delta, id)
		} else {
			ids.cumulative = append(ids.cumulative, id)
		}
	}
	return exporters, ids
}

func buildUpstreamExporter(e Exporter) (string, obj) {
	var id string
	var exp obj
	switch e.Protocol {
	case "grpc":
		endpoint, insecure := normalizeGRPCURL(e.URL)
		id = "otlp_grpc/" + e.Name
		exp = obj{"endpoint": endpoint}
		if insecure {
			exp["tls"] = obj{"insecure": true}
		}
	case "http":
		id = "otlphttp/" + e.Name
		exp = obj{"endpoint": e.URL}
	default:
		return "", nil
	}
	if headers := renderHeaders(e.Headers); len(headers) > 0 {
		exp["headers"] = headers
	}
	if queue := sendingQueueConfig(e.Batch); queue != nil {
		exp["sending_queue"] = queue
	}
	return id, exp
}

// sendingQueueConfig turns on exporterhelper batching, which is off by
// default. Only the fields the user set are emitted; an empty batch section
// still enables batching with exporterhelper's own defaults.
func sendingQueueConfig(b BatchConfig) obj {
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

// normalizeGRPCURL maps an http(s) URL onto the exporter's host:port
// endpoint, with the scheme deciding TLS. Anything else, including a bare
// host:port, is passed through and keeps the exporter's default of TLS on.
func normalizeGRPCURL(raw string) (endpoint string, insecure bool) {
	// url.Parse would misread a bare host:port's host as the scheme.
	if !strings.Contains(raw, "://") {
		return raw, false
	}
	u, err := url.Parse(raw)
	if err != nil {
		return raw, false
	}
	switch strings.ToLower(u.Scheme) {
	case "http":
		return u.Host, true
	case "https":
		return u.Host, false
	default:
		return raw, false
	}
}

// New creates a new OTel Collector configured with an OTLP receiver
// and the otelop custom exporter.
func New(exporterFactory exporter.Factory, cfg Config) (*otelcol.Collector, error) {
	factories, err := components(exporterFactory)
	if err != nil {
		return nil, err
	}

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
			ResolverSettings: resolverSettings(buildConfigMap(cfg)),
		},
		DisableGracefulShutdown: true,
	}

	return otelcol.NewCollector(set)
}

// resolverSettings serves the generated config and lets the Collector expand
// ${env:NAME} references in it, the same syntax a standalone
// Collector config uses, so secrets such as API keys stay out of the otelop
// config file.
func resolverSettings(cfg obj) confmap.ResolverSettings {
	return confmap.ResolverSettings{
		URIs: []string{"otelop:config"},
		ProviderFactories: []confmap.ProviderFactory{
			newStaticProviderFactory(cfg),
			envprovider.NewFactory(),
		},
	}
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
