package collector

import (
	"context"
	"reflect"
	"testing"

	"go.opentelemetry.io/collector/confmap"
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
	pipelines := cfg["service"].(obj)["pipelines"].(obj)
	for _, name := range []string{"traces", "metrics", "logs"} {
		got := pipelines[name].(obj)["exporters"].([]any)
		if !reflect.DeepEqual(got, []any{"otelop", "otlphttp/proxy"}) {
			t.Fatalf("%s exporters = %#v", name, got)
		}
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
