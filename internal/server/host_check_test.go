package server

import "testing"

func TestIsLocalHost(t *testing.T) {
	tests := []struct {
		host string
		want bool
	}{
		{host: "localhost", want: true},
		{host: "localhost:4319", want: true},
		{host: "LOCALHOST:4319", want: true},
		{host: "foo.localhost:4319", want: true},
		{host: "127.0.0.1", want: true},
		{host: "127.0.0.1:4319", want: true},
		{host: "192.168.1.5:4319", want: true},
		{host: "::1", want: true},
		{host: "[::1]", want: true},
		{host: "[::1]:4319", want: true},
		{host: "evil.com", want: false},
		{host: "evil.com:4319", want: false},
		{host: "notlocalhost:4319", want: false},
		{host: "localhost.evil.com:4319", want: false},
		{host: "", want: false},
	}
	for _, tc := range tests {
		t.Run(tc.host, func(t *testing.T) {
			if got := isLocalHost(tc.host); got != tc.want {
				t.Errorf("isLocalHost(%q) = %v, want %v", tc.host, got, tc.want)
			}
		})
	}
}

func TestIsAllowedHost(t *testing.T) {
	allowed := []string{"otelop.internal", "*.example.com"}
	tests := []struct {
		host string
		want bool
	}{
		// Always-allowed regardless of the allowlist.
		{host: "localhost:4319", want: true},
		{host: "127.0.0.1:4319", want: true},
		{host: "[::1]:4319", want: true},
		// Exact allowlist match, case-insensitive, port ignored.
		{host: "otelop.internal", want: true},
		{host: "otelop.internal:4319", want: true},
		{host: "OTELOP.INTERNAL:4319", want: true},
		// Wildcard allowlist entry: matches the bare domain and any depth of
		// subdomain.
		{host: "example.com:4319", want: true},
		{host: "foo.example.com:4319", want: true},
		{host: "foo.bar.example.com:4319", want: true},
		{host: "EXAMPLE.COM:4319", want: true},
		// Not on the allowlist and not otherwise local.
		{host: "evil.com:4319", want: false},
		{host: "notexample.com:4319", want: false},
		{host: "example.com.evil.com:4319", want: false},
		{host: "", want: false},
	}
	for _, tc := range tests {
		t.Run(tc.host, func(t *testing.T) {
			if got := isAllowedHost(tc.host, allowed); got != tc.want {
				t.Errorf("isAllowedHost(%q, %v) = %v, want %v", tc.host, allowed, got, tc.want)
			}
		})
	}
}

func TestIsAllowedHost_EmptyAllowlistKeepsStrictBehavior(t *testing.T) {
	if isAllowedHost("otelop.internal:4319", nil) {
		t.Error("isAllowedHost with empty allowlist should reject a non-local hostname")
	}
	if !isAllowedHost("localhost:4319", nil) {
		t.Error("isAllowedHost with empty allowlist should still allow localhost")
	}
}

func TestHostMatchesPattern(t *testing.T) {
	tests := []struct {
		host    string
		pattern string
		want    bool
	}{
		{host: "otelop.internal", pattern: "otelop.internal", want: true},
		{host: "otelop.internal", pattern: "OTELOP.INTERNAL", want: true},
		{host: "other.internal", pattern: "otelop.internal", want: false},
		{host: "example.com", pattern: "*.example.com", want: true},
		{host: "foo.example.com", pattern: "*.example.com", want: true},
		{host: "foo.bar.example.com", pattern: "*.example.com", want: true},
		{host: "notexample.com", pattern: "*.example.com", want: false},
		{host: "example.com.evil.com", pattern: "*.example.com", want: false},
		{host: "example.com", pattern: "", want: false},
	}
	for _, tc := range tests {
		t.Run(tc.host+"/"+tc.pattern, func(t *testing.T) {
			if got := hostMatchesPattern(tc.host, tc.pattern); got != tc.want {
				t.Errorf("hostMatchesPattern(%q, %q) = %v, want %v", tc.host, tc.pattern, got, tc.want)
			}
		})
	}
}
