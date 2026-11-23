package runtime

import (
	"reflect"
	"strings"
	"testing"

	"github.com/mashiro/otelop/internal/collector"
	"github.com/mashiro/otelop/internal/config"
	otelopgraphql "github.com/mashiro/otelop/internal/graphql"
)

func TestResolveStorageOptions_ParsesMemoryLimit(t *testing.T) {
	dir := t.TempDir()
	path, retention, maxSize, memoryLimit, err := resolveStorageOptions(Options{
		StoragePath: dir + "/otelop.duckdb",
		Retention:   "7d",
		MaxSize:     "4GB",
		MemoryLimit: "256MB",
	})
	if err != nil {
		t.Fatalf("resolveStorageOptions: %v", err)
	}
	if path == "" {
		t.Errorf("path = %q, want non-empty", path)
	}
	if retention <= 0 {
		t.Errorf("retention = %v, want > 0", retention)
	}
	if maxSize != 4_000_000_000 {
		t.Errorf("maxSize = %d, want 4_000_000_000", maxSize)
	}
	if memoryLimit != 256_000_000 {
		t.Errorf("memoryLimit = %d, want 256_000_000", memoryLimit)
	}
}

func TestResolveStorageOptions_InvalidMemoryLimitErrors(t *testing.T) {
	_, _, _, _, err := resolveStorageOptions(Options{
		Retention:   "7d",
		MaxSize:     "4GB",
		MemoryLimit: "not-a-size",
	})
	if err == nil || !strings.Contains(err.Error(), "memory_limit") {
		t.Fatalf("resolveStorageOptions error = %v, want it to mention memory_limit", err)
	}
}

func TestValidateRejectsInvalidRenderWindow(t *testing.T) {
	for _, v := range []int{0, -1, -500} {
		if err := Validate(Options{RenderWindowMax: v}); err == nil {
			t.Errorf("Validate(RenderWindowMax=%d) = nil, want error", v)
		}
	}
}

func TestExportersFromConfig_SortsAndNormalizes(t *testing.T) {
	got := ExportersFromConfig(map[string]config.ExporterConfig{
		"zeta": {URL: " https://zeta.example.com ", Protocol: " HTTP ", MetricsTemporality: " Delta "},
		"alpha": {
			URL:      "alpha.example.com:4317",
			Protocol: "grpc",
			Batch:    config.ExporterBatchConfig{Enabled: true, FlushTimeout: " 1s ", Sizer: " Bytes ", MinSize: 1, MaxSize: 2},
			Auth:     config.ExporterAuthConfig{Type: " Bearer ", Token: "t"},
		},
	})
	want := []ExporterOptions{
		{
			Name:     "alpha",
			URL:      "alpha.example.com:4317",
			Protocol: "grpc",
			Batch:    ExporterBatchOptions{Enabled: true, FlushTimeout: "1s", Sizer: "bytes", MinSize: 1, MaxSize: 2},
			Auth:     ExporterAuthOptions{Type: "bearer", Token: "t"},
		},
		{Name: "zeta", URL: "https://zeta.example.com", Protocol: "http", MetricsTemporality: "delta"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ExportersFromConfig =\n %+v\nwant\n %+v", got, want)
	}
	if got := ExportersFromConfig(nil); got != nil {
		t.Errorf("ExportersFromConfig(nil) = %+v, want nil", got)
	}
}

func validExporter(name string) ExporterOptions {
	return ExporterOptions{Name: name, URL: "https://collector.example.com:4318", Protocol: "http"}
}

func validateWith(exporters ...ExporterOptions) error {
	return Validate(Options{
		RenderWindowMax: 1,
		OTLPGRPCAddr:    "0.0.0.0:4317",
		OTLPHTTPAddr:    "0.0.0.0:4318",
		Exporters:       exporters,
	})
}

func TestValidateExporters_Accepts(t *testing.T) {
	grpc := validExporter("grpc")
	grpc.Protocol = "grpc"
	grpc.URL = "https://collector.example.com:4317"
	delta := validExporter("delta-1")
	delta.MetricsTemporality = "delta"
	batched := validExporter("batched_2")
	batched.Batch = ExporterBatchOptions{Enabled: true, MaxSize: 4096}
	bearer := validExporter("bearer")
	bearer.Auth = ExporterAuthOptions{Type: "bearer", Token: "token"}
	portless := validExporter("portless")
	portless.URL = "https://collector.example.com"
	envToken := validExporter("env-token")
	envToken.Auth = ExporterAuthOptions{Type: "bearer", Token: "${env:UPSTREAM_TOKEN}"}
	envHeader := validExporter("env-header")
	envHeader.Auth = ExporterAuthOptions{Type: "headers", Headers: map[string]string{"X-Api-Key": "${env:UPSTREAM_API_KEY}"}}
	bareHost := validExporter("bare-host")
	bareHost.Protocol = "grpc"
	bareHost.URL = "collector.example.com:4317"
	bareIP := validExporter("bare-ip")
	bareIP.Protocol = "grpc"
	bareIP.URL = "192.0.2.10:4317"
	bareIPv6 := validExporter("bare-ipv6")
	bareIPv6.Protocol = "grpc"
	bareIPv6.URL = "[2001:db8::1]:4317"

	if err := validateWith(); err != nil {
		t.Errorf("no exporters: %v", err)
	}
	if err := validateWith(grpc, delta, batched, bearer, portless, bareHost, bareIP, bareIPv6, envToken, envHeader); err != nil {
		t.Errorf("valid exporters: %v", err)
	}
}

func TestValidateExporters_Rejects(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(*ExporterOptions)
		wantErr string
	}{
		{"name with slash", func(e *ExporterOptions) { e.Name = "a/b" }, `exporters."a/b": name may only contain`},
		{"name with space", func(e *ExporterOptions) { e.Name = "a b" }, `exporters."a b": name may only contain`},
		{"missing url", func(e *ExporterOptions) { e.URL = "" }, "exporters.up: url is required"},
		{"missing protocol", func(e *ExporterOptions) { e.Protocol = "" }, "exporters.up: protocol is required"},
		{"unknown protocol", func(e *ExporterOptions) { e.Protocol = "udp" }, `exporters.up: invalid protocol "udp"`},
		{"credentials in url", func(e *ExporterOptions) { e.URL = "https://user:pass@collector.example.com" }, "exporters.up: url must not contain embedded credentials"},
		{"http url without scheme", func(e *ExporterOptions) { e.URL = "collector.example.com:4318" }, "exporters.up: invalid url"},
		{"grpc url with path", func(e *ExporterOptions) { e.Protocol = "grpc"; e.URL = "collector.example.com/v1" }, "exporters.up: invalid url"},
		{"self http", func(e *ExporterOptions) { e.URL = "http://127.0.0.1:4318" }, "exporters.up: url \"http://127.0.0.1:4318\" points back to otelop's own OTLP http listener"},
		{"self grpc", func(e *ExporterOptions) { e.Protocol = "grpc"; e.URL = "http://localhost:4317" }, "points back to otelop's own OTLP grpc listener"},
		{"self grpc bare host", func(e *ExporterOptions) { e.Protocol = "grpc"; e.URL = "localhost:4317" }, "points back to otelop's own OTLP grpc listener"},
		{"self grpc bare ip", func(e *ExporterOptions) { e.Protocol = "grpc"; e.URL = "127.0.0.1:4317" }, "points back to otelop's own OTLP grpc listener"},
		{"grpc bare without port", func(e *ExporterOptions) { e.Protocol = "grpc"; e.URL = "collector.example.com" }, `exporters.up: invalid url "collector.example.com" for grpc`},
		{"grpc bare with empty port", func(e *ExporterOptions) { e.Protocol = "grpc"; e.URL = "collector.example.com:" }, `exporters.up: invalid url "collector.example.com:" for grpc`},
		{"grpc bare with credentials", func(e *ExporterOptions) { e.Protocol = "grpc"; e.URL = "user@collector.example.com:4317" }, "exporters.up: url must not contain embedded credentials"},
		{"temporality", func(e *ExporterOptions) { e.MetricsTemporality = "cumulative" }, `exporters.up: invalid metrics_temporality "cumulative"`},
		{"batch without enabled", func(e *ExporterOptions) { e.Batch.MaxSize = 4096 }, "exporters.up: batch settings require batch.enabled = true"},
		{"auth fields without type", func(e *ExporterOptions) { e.Auth.Token = "t" }, "exporters.up: auth fields require auth.type"},
		{"bearer without token", func(e *ExporterOptions) { e.Auth.Type = "bearer" }, "exporters.up: auth.type bearer requires auth.token"},
		{"basic without password", func(e *ExporterOptions) { e.Auth = ExporterAuthOptions{Type: "basic", Username: "u"} }, "exporters.up: auth.type basic requires auth.username and auth.password"},
		{"headers empty", func(e *ExporterOptions) { e.Auth.Type = "headers" }, "exporters.up: auth.type headers requires auth.headers"},
		{"unknown auth", func(e *ExporterOptions) { e.Auth.Type = "digest" }, `exporters.up: invalid auth.type "digest"`},
		{"env reference in url", func(e *ExporterOptions) { e.URL = "https://${env:UPSTREAM_HOST}" }, "exporters.up: url cannot reference environment variables"},
		{"env reference in basic password", func(e *ExporterOptions) {
			e.Auth = ExporterAuthOptions{Type: "basic", Username: "u", Password: "${env:UPSTREAM_PASSWORD}"}
		}, "exporters.up: auth.username and auth.password cannot reference environment variables"},
		{"env reference in basic username", func(e *ExporterOptions) {
			e.Auth = ExporterAuthOptions{Type: "basic", Username: "${env:UPSTREAM_USER}", Password: "p"}
		}, "exporters.up: auth.username and auth.password cannot reference environment variables"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := validExporter("up")
			tc.mutate(&e)
			err := validateWith(e)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("Validate error = %v, want it to contain %q", err, tc.wantErr)
			}
		})
	}
}

func TestValidateExporters_SelfExportWithDefaultPort(t *testing.T) {
	e := validExporter("up")
	e.URL = "http://localhost"
	err := Validate(Options{RenderWindowMax: 1, OTLPGRPCAddr: "0.0.0.0:4317", OTLPHTTPAddr: "0.0.0.0:80", Exporters: []ExporterOptions{e}})
	if err == nil || !strings.Contains(err.Error(), "points back to otelop's own OTLP http listener") {
		t.Fatalf("Validate error = %v", err)
	}
}

func TestBuildExporterHeaders(t *testing.T) {
	headers := buildExporterHeaders(ExporterAuthOptions{
		Type:     "basic",
		Username: "alice",
		Password: "secret",
	})
	if got := headers["Authorization"]; got != "Basic YWxpY2U6c2VjcmV0" {
		t.Fatalf("Authorization = %q", got)
	}
}

func TestRedactURL(t *testing.T) {
	got := RedactURL("https://user:pass@example.com:4318")
	if got != "https://REDACTED:REDACTED@example.com:4318" {
		t.Fatalf("RedactURL = %q", got)
	}
}

func TestCollectorExporters(t *testing.T) {
	got := collectorExporters([]ExporterOptions{{
		Name:               "up",
		URL:                "https://collector.example.com",
		Protocol:           "http",
		MetricsTemporality: "delta",
		Batch:              ExporterBatchOptions{Enabled: true, MaxSize: 10},
		Auth:               ExporterAuthOptions{Type: "bearer", Token: "t"},
	}})
	want := []collector.Exporter{{
		Name:               "up",
		URL:                "https://collector.example.com",
		Protocol:           "http",
		Headers:            map[string]string{"Authorization": "Bearer t"},
		MetricsTemporality: "delta",
		Batch:              collector.BatchConfig{Enabled: true, MaxSize: 10},
	}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("collectorExporters =\n %+v\nwant\n %+v", got, want)
	}
}

func TestExporterInfos_RedactsURL(t *testing.T) {
	got := exporterInfos([]ExporterOptions{{Name: "up", URL: "https://user:pass@collector.example.com", Protocol: "http"}})
	want := []otelopgraphql.ExporterInfo{{Name: "up", URL: "https://REDACTED:REDACTED@collector.example.com", Protocol: "http"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("exporterInfos = %+v, want %+v", got, want)
	}
}
