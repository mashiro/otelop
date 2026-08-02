package main

import (
	"slices"
	"testing"
)

func TestSplitCSV(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want []string
	}{
		{name: "empty", in: "", want: nil},
		{name: "whitespace only", in: "   ", want: nil},
		{name: "single", in: "otelop.internal", want: []string{"otelop.internal"}},
		{name: "multiple", in: "otelop.internal,*.example.com", want: []string{"otelop.internal", "*.example.com"}},
		{name: "trims whitespace and drops empties", in: " otelop.internal ,, *.example.com ", want: []string{"otelop.internal", "*.example.com"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := splitCSV(tc.in)
			if !slices.Equal(got, tc.want) {
				t.Errorf("splitCSV(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}
