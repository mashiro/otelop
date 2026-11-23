package collector

import (
	"context"
	"reflect"
	"testing"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/confmap"
	"go.opentelemetry.io/collector/exporter"
)

func TestBuildConfigMap_WithoutProxy(t *testing.T) {
	cfg := buildConfigMap(Config{
		GRPCEndpoint: "0.0.0.0:4317",
		HTTPEndpoint: "0.0.0.0:4318",
		LogLevel:     "warn",
	})
	exporters := cfg["exporters"].(obj)
	if _, ok := exporters["otlp_grpc/proxy"]; ok {
		t.Fatalf("buildConfigMap unexpectedly included grpc proxy exporter")
	}
	if _, ok := exporters["otlphttp/proxy"]; ok {
		t.Fatalf("buildConfigMap unexpectedly included http proxy exporter")
	}
	pipelines := cfg["service"].(obj)["pipelines"].(obj)
	for _, name := range []string{"traces", "metrics", "logs"} {
		got := pipelines[name].(obj)["exporters"].([]any)
		if !reflect.DeepEqual(got, []any{"otelop"}) {
			t.Fatalf("%s exporters = %#v", name, got)
		}
	}
}

func TestBuildConfigMap_WithGRPCProxy(t *testing.T) {
	cfg := buildConfigMap(Config{
		GRPCEndpoint:  "0.0.0.0:4317",
		HTTPEndpoint:  "0.0.0.0:4318",
		ProxyURL:      "http://upstream.example.com:4317",
		ProxyProtocol: "grpc",
		ProxyHeaders: map[string]string{
			"Authorization": "Bearer token",
		},
		LogLevel: "info",
	})
	exporters := cfg["exporters"].(obj)
	exp, ok := exporters["otlp_grpc/proxy"].(obj)
	if !ok {
		t.Fatalf("buildConfigMap missing grpc proxy exporter")
	}
	if exp["endpoint"] != "upstream.example.com:4317" {
		t.Fatalf("grpc endpoint = %#v", exp["endpoint"])
	}
	if !reflect.DeepEqual(exp["tls"], obj{"insecure": true}) {
		t.Fatalf("grpc tls = %#v", exp["tls"])
	}
	headers := exp["headers"].(obj)
	if headers["Authorization"] != "Bearer token" {
		t.Fatalf("grpc headers = %#v", headers)
	}
	if _, ok := exp["sending_queue"]; ok {
		t.Fatalf("sending_queue = %#v, want exporter defaults when batching is off", exp["sending_queue"])
	}
	pipelines := cfg["service"].(obj)["pipelines"].(obj)
	for _, name := range []string{"traces", "metrics", "logs"} {
		got := pipelines[name].(obj)["exporters"].([]any)
		if !reflect.DeepEqual(got, []any{"otelop", "otlp_grpc/proxy"}) {
			t.Fatalf("%s exporters = %#v", name, got)
		}
	}
}

func TestBuildConfigMap_WithHTTPProxy(t *testing.T) {
	cfg := buildConfigMap(Config{
		GRPCEndpoint:  "0.0.0.0:4317",
		HTTPEndpoint:  "0.0.0.0:4318",
		ProxyURL:      "http://upstream.example.com:4318",
		ProxyProtocol: "http",
		ProxyHeaders: map[string]string{
			"x-api-key": "secret",
		},
		LogLevel: "debug",
	})
	exporters := cfg["exporters"].(obj)
	exp, ok := exporters["otlphttp/proxy"].(obj)
	if !ok {
		t.Fatalf("buildConfigMap missing http proxy exporter")
	}
	if exp["endpoint"] != "http://upstream.example.com:4318" {
		t.Fatalf("http endpoint = %#v", exp["endpoint"])
	}
	headers := exp["headers"].(obj)
	if headers["x-api-key"] != "secret" {
		t.Fatalf("http headers = %#v", headers)
	}
	if _, ok := exp["sending_queue"]; ok {
		t.Fatalf("sending_queue = %#v, want exporter defaults when batching is off", exp["sending_queue"])
	}
	pipelines := cfg["service"].(obj)["pipelines"].(obj)
	for _, name := range []string{"traces", "metrics", "logs"} {
		got := pipelines[name].(obj)["exporters"].([]any)
		if !reflect.DeepEqual(got, []any{"otelop", "otlphttp/proxy"}) {
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

func TestBuildConfigMap_ProxyWithoutDeltaKeepsSharedMetricsPipeline(t *testing.T) {
	cfg := buildConfigMap(Config{
		GRPCEndpoint:  "0.0.0.0:4317",
		HTTPEndpoint:  "0.0.0.0:4318",
		ProxyURL:      "http://upstream.example.com:4318",
		ProxyProtocol: "http",
		LogLevel:      "info",
	})
	if _, ok := cfg["processors"]; ok {
		t.Fatalf("buildConfigMap unexpectedly included processors: %#v", cfg["processors"])
	}
	pipelines := cfg["service"].(obj)["pipelines"].(obj)
	if _, ok := pipelines["metrics/proxy"]; ok {
		t.Fatalf("buildConfigMap unexpectedly split the metrics pipeline")
	}
}

func TestBuildConfigMap_WithHTTPProxyDeltaMetrics(t *testing.T) {
	cfg := buildConfigMap(Config{
		GRPCEndpoint:            "0.0.0.0:4317",
		HTTPEndpoint:            "0.0.0.0:4318",
		ProxyURL:                "https://collector.example.com",
		ProxyProtocol:           "http",
		ProxyMetricsTemporality: "delta",
		LogLevel:                "info",
	})
	processors, ok := cfg["processors"].(obj)
	if !ok {
		t.Fatalf("buildConfigMap missing processors: %#v", cfg)
	}
	if _, ok := processors["cumulativetodelta"]; !ok {
		t.Fatalf("processors = %#v, want cumulativetodelta", processors)
	}

	pipelines := cfg["service"].(obj)["pipelines"].(obj)
	for _, name := range []string{"traces", "logs"} {
		got := pipelines[name].(obj)["exporters"].([]any)
		if !reflect.DeepEqual(got, []any{"otelop", "otlphttp/proxy"}) {
			t.Fatalf("%s exporters = %#v", name, got)
		}
	}

	local := pipelines["metrics"].(obj)
	if got := local["exporters"].([]any); !reflect.DeepEqual(got, []any{"otelop"}) {
		t.Fatalf("metrics exporters = %#v, want only otelop so storage keeps cumulative points", got)
	}
	if _, ok := local["processors"]; ok {
		t.Fatalf("metrics pipeline must not convert temporality: %#v", local["processors"])
	}

	upstream, ok := pipelines["metrics/proxy"].(obj)
	if !ok {
		t.Fatalf("buildConfigMap missing metrics/proxy pipeline: %#v", pipelines)
	}
	if got := upstream["receivers"].([]any); !reflect.DeepEqual(got, []any{"otlp"}) {
		t.Fatalf("metrics/proxy receivers = %#v", got)
	}
	if got := upstream["processors"].([]any); !reflect.DeepEqual(got, []any{"cumulativetodelta"}) {
		t.Fatalf("metrics/proxy processors = %#v", got)
	}
	if got := upstream["exporters"].([]any); !reflect.DeepEqual(got, []any{"otlphttp/proxy"}) {
		t.Fatalf("metrics/proxy exporters = %#v", got)
	}
}

func TestComponents_RegistersCumulativeToDelta(t *testing.T) {
	otelop := exporter.NewFactory(component.MustNewType("otelop"), func() component.Config { return &struct{}{} })
	factories, err := components(otelop)
	if err != nil {
		t.Fatalf("components: %v", err)
	}
	if _, ok := factories.Processors[component.MustNewType("cumulativetodelta")]; !ok {
		t.Fatalf("cumulativetodelta processor factory not registered")
	}
}

func TestBuildConfigMap_ProxyBatch(t *testing.T) {
	for _, tc := range []struct {
		name     string
		protocol string
		url      string
		exporter string
		batch    ProxyBatchConfig
		want     obj
	}{
		{
			name:     "grpc exporter defaults",
			protocol: "grpc",
			url:      "https://collector.example.com:4317",
			exporter: "otlp_grpc/proxy",
			batch:    ProxyBatchConfig{Enabled: true},
			want:     obj{},
		},
		{
			name:     "http overrides",
			protocol: "http",
			url:      "https://collector.example.com:4318",
			exporter: "otlphttp/proxy",
			batch:    ProxyBatchConfig{Enabled: true, FlushTimeout: "1s", Sizer: "bytes", MinSize: 1024, MaxSize: 4096},
			want:     obj{"flush_timeout": "1s", "sizer": "bytes", "min_size": int64(1024), "max_size": int64(4096)},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := buildConfigMap(Config{
				GRPCEndpoint:  "0.0.0.0:4317",
				HTTPEndpoint:  "0.0.0.0:4318",
				ProxyURL:      tc.url,
				ProxyProtocol: tc.protocol,
				ProxyBatch:    tc.batch,
				LogLevel:      "info",
			})
			exp := cfg["exporters"].(obj)[tc.exporter].(obj)
			want := obj{"batch": tc.want}
			if !reflect.DeepEqual(exp["sending_queue"], want) {
				t.Fatalf("sending_queue = %#v, want %#v", exp["sending_queue"], want)
			}
		})
	}
}
