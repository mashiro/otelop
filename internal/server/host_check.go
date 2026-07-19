package server

import (
	"net"
	"net/http"
	"strings"
)

// requireLocalHost blocks DNS rebinding attacks against otelop's raw data
// endpoints. A page served from an attacker-controlled DNS name that
// resolves to 127.0.0.1 would still satisfy same-origin checks (its Origin
// header matches its own Host header) while running attacker JS against the
// local server. Restricting Host to IP literals and localhost forecloses
// that, since DNS rebinding depends on the browser being tricked via a
// hostname — an IP literal or "localhost" can't be rebound. This mirrors the
// approach Vite's dev server uses for `server.allowedHosts`.
func requireLocalHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isLocalHost(r.Host) {
			http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// isLocalHost reports whether host — an http.Request.Host value, optionally
// carrying a port — names an IP literal (v4 or v6), "localhost", or a
// "*.localhost" subdomain.
func isLocalHost(host string) bool {
	h := host
	if hostname, _, err := net.SplitHostPort(host); err == nil {
		h = hostname
	}
	// A bracketed IPv6 literal without a port (e.g. "[::1]") isn't valid
	// input for SplitHostPort, so strip the brackets by hand.
	h = strings.TrimSuffix(strings.TrimPrefix(h, "["), "]")
	if h == "" {
		return false
	}
	if net.ParseIP(h) != nil {
		return true
	}
	lower := strings.ToLower(h)
	return lower == "localhost" || strings.HasSuffix(lower, ".localhost")
}
