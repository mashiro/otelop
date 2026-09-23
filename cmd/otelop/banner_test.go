package main

import "testing"

func TestFormatProxy(t *testing.T) {
	tests := []struct {
		name          string
		proxyURL      string
		proxyProtocol string
		fallback      string
		want          string
	}{
		{"disabled fallback when unset", "", "", "disabled", "disabled"},
		{"none fallback when unset", "", "", "(none)", "(none)"},
		{"missing protocol falls back", "https://upstream.example.com:4317", "", "disabled", "disabled"},
		{"missing url falls back", "", "grpc", "disabled", "disabled"},
		{"formats protocol uppercase with url", "https://upstream.example.com:4317", "grpc", "disabled", "GRPC https://upstream.example.com:4317"},
		{"formats http protocol with url", "https://upstream.example.com:4318", "http", "(none)", "HTTP https://upstream.example.com:4318"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatProxy(tt.proxyURL, tt.proxyProtocol, tt.fallback); got != tt.want {
				t.Errorf("formatProxy(%q, %q, %q) = %q, want %q", tt.proxyURL, tt.proxyProtocol, tt.fallback, got, tt.want)
			}
		})
	}
}
