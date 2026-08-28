package server

import (
	"net"
	"net/http"
	"strings"
)

// requireLocalHost blocks DNS rebinding against a loopback-only listener. A
// page served from an attacker-controlled DNS name that resolves to 127.0.0.1
// would otherwise appear same-origin to the browser while reaching otelop.
// Non-loopback listeners deliberately do not use this middleware: choosing a
// network-visible bind address delegates reachability and host policy to the
// operator's network path (for example an ingress or load balancer).
func requireLocalHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isLocalHost(r.Host) {
			http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// isLoopbackListenAddr reports whether addr binds to a loopback interface.
// Wildcard binds (an empty host, 0.0.0.0, or ::) and named/non-loopback
// interfaces are network-visible and therefore return false.
func isLoopbackListenAddr(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// isLocalHost reports whether host — an http.Request.Host value, optionally
// carrying a port — names an IP literal (v4 or v6), "localhost", or a
// "*.localhost" subdomain. None of them can be a DNS rebinding target.
func isLocalHost(host string) bool {
	h := hostnameOnly(host)
	if h == "" {
		return false
	}
	if net.ParseIP(h) != nil {
		return true
	}
	lower := strings.ToLower(h)
	return lower == "localhost" || strings.HasSuffix(lower, ".localhost")
}

// hostnameOnly strips an optional ":port" suffix (and, for a bracketed IPv6
// literal, the brackets) from an http.Request.Host value.
func hostnameOnly(host string) string {
	h := host
	if hostname, _, err := net.SplitHostPort(host); err == nil {
		h = hostname
	}
	// A bracketed IPv6 literal without a port (e.g. "[::1]") isn't valid
	// input for SplitHostPort, so strip the brackets by hand.
	return strings.TrimSuffix(strings.TrimPrefix(h, "["), "]")
}
