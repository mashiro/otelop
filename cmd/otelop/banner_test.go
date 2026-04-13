package main

import (
	"testing"
)

func TestResolveLoopback(t *testing.T) {
	tests := []struct {
		input   string
		want    string
		wantErr bool
	}{
		{"0.0.0.0:4317", "localhost:4317", false},
		{"[::]:4317", "localhost:4317", false},
		{":4317", "localhost:4317", false},
		{"localhost:4317", "localhost:4317", false},
		{"127.0.0.1:5317", "127.0.0.1:5317", false},
		{"192.168.1.1:9317", "192.168.1.1:9317", false},
		{"invalid", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := resolveLoopback(tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("resolveLoopback(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
			if got != tt.want {
				t.Errorf("resolveLoopback(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
