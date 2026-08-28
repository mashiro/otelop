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

func TestIsLoopbackListenAddr(t *testing.T) {
	tests := []struct {
		addr string
		want bool
	}{
		{addr: "localhost:4319", want: true},
		{addr: "LOCALHOST:4319", want: true},
		{addr: "127.0.0.1:4319", want: true},
		{addr: "127.42.0.1:4319", want: true},
		{addr: "[::1]:4319", want: true},
		{addr: "0.0.0.0:4319", want: false},
		{addr: ":4319", want: false},
		{addr: "[::]:4319", want: false},
		{addr: "192.168.1.5:4319", want: false},
		{addr: "otelop.internal:4319", want: false},
		{addr: "invalid", want: false},
	}
	for _, tc := range tests {
		t.Run(tc.addr, func(t *testing.T) {
			if got := isLoopbackListenAddr(tc.addr); got != tc.want {
				t.Errorf("isLoopbackListenAddr(%q) = %v, want %v", tc.addr, got, tc.want)
			}
		})
	}
}
