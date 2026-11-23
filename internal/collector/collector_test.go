package collector

import (
	"context"
	"reflect"
	"testing"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/exporter"
)

func pipelineExporters(t *testing.T, cfg map[string]any, name string) []any {
	t.Helper()
	pipeline, ok := cfg["service"].(obj)["pipelines"].(obj)[name].(obj)
	if !ok {
		t.Fatalf("pipeline %s missing", name)
	}
	return pipeline["exporters"].([]any)
}

func TestBuildConfigMap_WithoutExporters(t *testing.T) {
	cfg := buildConfigMap(Config{
		GRPCEndpoint: "0.0.0.0:4317",
		HTTPEndpoint: "0.0.0.0:4318",
		LogLevel:     "warn",
	})
	if got := cfg["exporters"].(obj); !reflect.DeepEqual(got, obj{"otelop": obj{}}) {
		t.Fatalf("exporters = %#v, want only otelop", got)
	}
	if _, ok := cfg["processors"]; ok {
		t.Fatalf("buildConfigMap unexpectedly included processors: %#v", cfg["processors"])
	}
	for _, name := range []string{"traces", "metrics", "logs"} {
		if got := pipelineExporters(t, cfg, name); !reflect.DeepEqual(got, []any{"otelop"}) {
			t.Fatalf("%s exporters = %#v", name, got)
		}
	}
}

func TestBuildConfigMap_GRPCExporter(t *testing.T) {
	cfg := buildConfigMap(Config{
		GRPCEndpoint: "0.0.0.0:4317",
		HTTPEndpoint: "0.0.0.0:4318",
		Exporters: []Exporter{{
			Name:     "primary",
			URL:      "http://upstream.example.com:4317",
			Protocol: "grpc",
			Headers:  map[string]string{"Authorization": "Bearer token"},
		}},
		LogLevel: "info",
	})
	want := obj{
		"endpoint": "upstream.example.com:4317",
		"tls":      obj{"insecure": true},
		"headers":  obj{"Authorization": "Bearer token"},
	}
	if got := cfg["exporters"].(obj)["otlp_grpc/primary"]; !reflect.DeepEqual(got, want) {
		t.Fatalf("otlp_grpc/primary = %#v, want %#v", got, want)
	}
	for _, name := range []string{"traces", "metrics", "logs"} {
		if got := pipelineExporters(t, cfg, name); !reflect.DeepEqual(got, []any{"otelop", "otlp_grpc/primary"}) {
			t.Fatalf("%s exporters = %#v", name, got)
		}
	}
}

func TestBuildConfigMap_GRPCExporterEndpointForms(t *testing.T) {
	for _, tc := range []struct {
		url  string
		want obj
	}{
		// No scheme leaves TLS to the exporter's default (on), as in the Collector.
		{"collector.example.com:4317", obj{"endpoint": "collector.example.com:4317"}},
		{"192.0.2.10:4317", obj{"endpoint": "192.0.2.10:4317"}},
		{"http://collector.example.com:4317", obj{"endpoint": "collector.example.com:4317", "tls": obj{"insecure": true}}},
		{"https://collector.example.com:4317", obj{"endpoint": "collector.example.com:4317"}},
		{"https://collector.example.com:4317/", obj{"endpoint": "collector.example.com:4317"}},
	} {
		t.Run(tc.url, func(t *testing.T) {
			cfg := buildConfigMap(Config{Exporters: []Exporter{{Name: "up", URL: tc.url, Protocol: "grpc"}}})
			if got := cfg["exporters"].(obj)["otlp_grpc/up"]; !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("otlp_grpc/up = %#v, want %#v", got, tc.want)
			}
		})
	}
}

func TestBuildConfigMap_HTTPExporter(t *testing.T) {
	cfg := buildConfigMap(Config{
		GRPCEndpoint: "0.0.0.0:4317",
		HTTPEndpoint: "0.0.0.0:4318",
		Exporters: []Exporter{{
			Name:     "primary",
			URL:      "https://upstream.example.com",
			Protocol: "http",
			Headers:  map[string]string{"x-api-key": "secret"},
		}},
		LogLevel: "debug",
	})
	want := obj{
		"endpoint": "https://upstream.example.com",
		"headers":  obj{"x-api-key": "secret"},
	}
	if got := cfg["exporters"].(obj)["otlp_http/primary"]; !reflect.DeepEqual(got, want) {
		t.Fatalf("otlp_http/primary = %#v, want %#v", got, want)
	}
	for _, name := range []string{"traces", "metrics", "logs"} {
		if got := pipelineExporters(t, cfg, name); !reflect.DeepEqual(got, []any{"otelop", "otlp_http/primary"}) {
			t.Fatalf("%s exporters = %#v", name, got)
		}
	}
}

func TestBuildConfigMap_SelfTelemetryDisabled(t *testing.T) {
	cfg := buildConfigMap(Config{
		GRPCEndpoint: "0.0.0.0:4317",
		HTTPEndpoint: "0.0.0.0:4318",
		LogLevel:     "info",
	})
	metrics := cfg["service"].(obj)["telemetry"].(obj)["metrics"].(obj)
	if metrics["level"] != "none" {
		t.Fatalf("metrics level = %#v, want none", metrics["level"])
	}
	if _, ok := metrics["readers"]; ok {
		t.Fatalf("metrics readers must be absent when endpoint is empty, got %#v", metrics["readers"])
	}
}

func TestBuildConfigMap_SelfTelemetryEnabled(t *testing.T) {
	cfg := buildConfigMap(Config{
		GRPCEndpoint:          "0.0.0.0:4317",
		HTTPEndpoint:          "0.0.0.0:4318",
		LogLevel:              "info",
		SelfTelemetryEndpoint: "localhost:4317",
	})
	metrics := cfg["service"].(obj)["telemetry"].(obj)["metrics"].(obj)
	if metrics["level"] != "normal" {
		t.Fatalf("metrics level = %#v, want normal", metrics["level"])
	}
	readers, ok := metrics["readers"].([]any)
	if !ok || len(readers) != 1 {
		t.Fatalf("metrics readers = %#v, want one entry", metrics["readers"])
	}
	periodic := readers[0].(obj)["periodic"].(obj)
	if periodic["interval"] != selfTelemetryIntervalMs {
		t.Fatalf("interval = %#v, want %d", periodic["interval"], selfTelemetryIntervalMs)
	}
	otlp := periodic["exporter"].(obj)["otlp"].(obj)
	if otlp["endpoint"] != "http://localhost:4317" {
		t.Fatalf("otlp endpoint = %#v", otlp["endpoint"])
	}
	if otlp["protocol"] != "grpc" {
		t.Fatalf("otlp protocol = %#v", otlp["protocol"])
	}
	if otlp["insecure"] != true {
		t.Fatalf("otlp insecure = %#v", otlp["insecure"])
	}
	if otlp["timeout"] != selfTelemetryExportTimeoutMs {
		t.Fatalf("otlp timeout = %#v, want %d", otlp["timeout"], selfTelemetryExportTimeoutMs)
	}
}

func TestBuildConfigMap_SelfTelemetryEndpointURLEncoded(t *testing.T) {
	cfg := buildConfigMap(Config{
		GRPCEndpoint:          "0.0.0.0:4317",
		HTTPEndpoint:          "0.0.0.0:4318",
		LogLevel:              "info",
		SelfTelemetryEndpoint: "[::1]:4317",
	})
	metrics := cfg["service"].(obj)["telemetry"].(obj)["metrics"].(obj)
	otlp := metrics["readers"].([]any)[0].(obj)["periodic"].(obj)["exporter"].(obj)["otlp"].(obj)
	if otlp["endpoint"] != "http://[::1]:4317" {
		t.Fatalf("otlp endpoint = %#v, want http://[::1]:4317", otlp["endpoint"])
	}
}

func TestStaticProviderNormalizesLocalObjTypes(t *testing.T) {
	factory := newStaticProviderFactory(buildConfigMap(Config{
		GRPCEndpoint: "0.0.0.0:4317",
		HTTPEndpoint: "0.0.0.0:4318",
		LogLevel:     "info",
	}))
	provider := factory.Create(confmap.ProviderSettings{})

	retrieved, err := provider.Retrieve(context.Background(), "otelop:config", nil)
	if err != nil {
		t.Fatalf("Retrieve: %v", err)
	}
	defer func() {
		if err := retrieved.Close(context.Background()); err != nil {
			t.Fatalf("Close: %v", err)
		}
	}()

	conf, err := retrieved.AsConf()
	if err != nil {
		t.Fatalf("AsConf: %v", err)
	}
	if got, ok := conf.ToStringMap()["exporters"].(map[string]any); !ok || got["otelop"] == nil {
		t.Fatalf("exporters.otelop missing in conf: %#v", conf.ToStringMap())
	}
}

func TestBuildConfigMap_MultipleExportersShareSignals(t *testing.T) {
	cfg := buildConfigMap(Config{
		GRPCEndpoint: "0.0.0.0:4317",
		HTTPEndpoint: "0.0.0.0:4318",
		Exporters: []Exporter{
			{Name: "b", URL: "https://b.example.com", Protocol: "http"},
			{Name: "a", URL: "a.example.com:4317", Protocol: "grpc"},
		},
		LogLevel: "info",
	})
	if _, ok := cfg["processors"]; ok {
		t.Fatalf("buildConfigMap unexpectedly included processors: %#v", cfg["processors"])
	}
	if _, ok := cfg["service"].(obj)["pipelines"].(obj)["metrics/delta"]; ok {
		t.Fatalf("buildConfigMap unexpectedly split the metrics pipeline")
	}
	want := []any{"otelop", "otlp_http/b", "otlp_grpc/a"}
	for _, name := range []string{"traces", "metrics", "logs"} {
		if got := pipelineExporters(t, cfg, name); !reflect.DeepEqual(got, want) {
			t.Fatalf("%s exporters = %#v, want %#v in the given order", name, got, want)
		}
	}
}

func TestBuildConfigMap_DeltaMetrics(t *testing.T) {
	for _, tc := range []struct {
		name        string
		exporters   []Exporter
		wantMetrics []any
		wantDelta   []any
		wantShared  []any
	}{
		{
			name: "mixed",
			exporters: []Exporter{
				{Name: "a", URL: "https://a.example.com", Protocol: "http", MetricsTemporality: "delta"},
				{Name: "b", URL: "b.example.com:4317", Protocol: "grpc"},
				{Name: "c", URL: "c.example.com:4317", Protocol: "grpc", MetricsTemporality: "delta"},
			},
			wantShared:  []any{"otelop", "otlp_http/a", "otlp_grpc/b", "otlp_grpc/c"},
			wantMetrics: []any{"otelop", "otlp_grpc/b"},
			wantDelta:   []any{"otlp_http/a", "otlp_grpc/c"},
		},
		{
			name: "all delta",
			exporters: []Exporter{
				{Name: "a", URL: "https://a.example.com", Protocol: "http", MetricsTemporality: "delta"},
			},
			wantShared:  []any{"otelop", "otlp_http/a"},
			wantMetrics: []any{"otelop"},
			wantDelta:   []any{"otlp_http/a"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := buildConfigMap(Config{
				GRPCEndpoint: "0.0.0.0:4317",
				HTTPEndpoint: "0.0.0.0:4318",
				Exporters:    tc.exporters,
				LogLevel:     "info",
			})
			if got := cfg["processors"]; !reflect.DeepEqual(got, obj{"cumulative_to_delta": obj{}}) {
				t.Fatalf("processors = %#v, want cumulative_to_delta", got)
			}
			for _, name := range []string{"traces", "logs"} {
				if got := pipelineExporters(t, cfg, name); !reflect.DeepEqual(got, tc.wantShared) {
					t.Fatalf("%s exporters = %#v, want %#v", name, got, tc.wantShared)
				}
			}

			pipelines := cfg["service"].(obj)["pipelines"].(obj)
			local := pipelines["metrics"].(obj)
			if got := local["exporters"].([]any); !reflect.DeepEqual(got, tc.wantMetrics) {
				t.Fatalf("metrics exporters = %#v, want %#v", got, tc.wantMetrics)
			}
			if _, ok := local["processors"]; ok {
				t.Fatalf("metrics pipeline must not convert temporality: %#v", local["processors"])
			}

			want := obj{
				"receivers":  []any{"otlp"},
				"processors": []any{"cumulative_to_delta"},
				"exporters":  tc.wantDelta,
			}
			if got := pipelines["metrics/delta"]; !reflect.DeepEqual(got, want) {
				t.Fatalf("metrics/delta = %#v, want %#v", got, want)
			}
		})
	}
}

func TestComponents_RegistersCumulativeToDelta(t *testing.T) {
	otelop := exporter.NewFactory(component.MustNewType("otelop"), func() component.Config { return &struct{}{} })
	factories, err := components(otelop)
	if err != nil {
		t.Fatalf("components: %v", err)
	}
	if _, ok := factories.Processors[component.MustNewType("cumulative_to_delta")]; !ok {
		t.Fatalf("cumulative_to_delta processor factory not registered")
	}
}

func TestBuildConfigMap_ExporterBatch(t *testing.T) {
	for _, tc := range []struct {
		name     string
		exporter Exporter
		id       string
		want     obj
	}{
		{
			name:     "grpc exporter defaults",
			exporter: Exporter{Name: "up", Protocol: "grpc", URL: "https://collector.example.com:4317", Batch: BatchConfig{Enabled: true}},
			id:       "otlp_grpc/up",
			want:     obj{},
		},
		{
			name: "http overrides",
			exporter: Exporter{Name: "up", Protocol: "http", URL: "https://collector.example.com:4318", Batch: BatchConfig{
				Enabled: true, FlushTimeout: "1s", Sizer: "bytes", MinSize: 1024, MaxSize: 4096,
			}},
			id:   "otlp_http/up",
			want: obj{"flush_timeout": "1s", "sizer": "bytes", "min_size": int64(1024), "max_size": int64(4096)},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := buildConfigMap(Config{
				GRPCEndpoint: "0.0.0.0:4317",
				HTTPEndpoint: "0.0.0.0:4318",
				Exporters:    []Exporter{tc.exporter},
				LogLevel:     "info",
			})
			exp := cfg["exporters"].(obj)[tc.id].(obj)
			want := obj{"batch": tc.want}
			if !reflect.DeepEqual(exp["sending_queue"], want) {
				t.Fatalf("sending_queue = %#v, want %#v", exp["sending_queue"], want)
			}
		})
	}
}

func TestResolverSettings_ExpandsEnvReferences(t *testing.T) {
	set := resolverSettings(obj{})
	schemes := make([]string, 0, len(set.ProviderFactories))
	for _, f := range set.ProviderFactories {
		schemes = append(schemes, f.Create(confmap.ProviderSettings{}).Scheme())
	}
	if want := []string{"otelop", "env"}; !reflect.DeepEqual(schemes, want) {
		t.Errorf("provider schemes = %v, want %v", schemes, want)
	}
	if want := []string{"otelop:config"}; !reflect.DeepEqual(set.URIs, want) {
		t.Errorf("URIs = %v, want %v", set.URIs, want)
	}
}
