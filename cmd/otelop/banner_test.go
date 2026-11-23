package main

import (
	"reflect"
	"testing"

	"github.com/mashiro/otelop/internal/daemon"
)

func TestExporterRows(t *testing.T) {
	if got, want := exporterRows(nil, "disabled"), (bannerRows{{"Exporters", "disabled"}}); !reflect.DeepEqual(got, want) {
		t.Errorf("exporterRows(nil) = %#v, want %#v", got, want)
	}

	got := exporterRows([]daemon.Exporter{
		{Name: "primary", URL: "https://upstream.example.com:4317", Protocol: "grpc"},
		{Name: "backup", URL: "https://backup.example.com", Protocol: "http"},
	}, "(none)")
	want := bannerRows{
		{"Exporters", "primary: GRPC https://upstream.example.com:4317"},
		{"", "backup: HTTP https://backup.example.com"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("exporterRows = %#v, want %#v", got, want)
	}
}
