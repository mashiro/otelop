package server

import (
	"net"
	"net/http"
	"strings"
)

// requireAllowedHost blocks DNS rebinding attacks against otelop's raw data
// endpoints. A page served from an attacker-controlled DNS name that
// resolves to 127.0.0.1 would still satisfy same-origin checks (its Origin
// header matches its own Host header) while running attacker JS against the
// local server. Restricting Host to IP literals, "localhost", and an
// operator-configured allowlist (allowed) forecloses that, since DNS
// rebinding depends on tricking the browser into trusting an
// attacker-registered hostname — an IP literal, "localhost", or a hostname
// the operator explicitly opted into (e.g. running otelop behind
// "otelop.internal") can't be rebound by a third party. This mirrors the
// approach Vite's dev server uses for `server.allowedHosts`.
func requireAllowedHost(allowed []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isAllowedHost(r.Host, allowed) {
			http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// isLocalHost reports whether host — an http.Request.Host value, optionally
// carrying a port — names an IP literal (v4 or v6), "localhost", or a
// "*.localhost" subdomain. These are always allowed, independent of any
// operator-configured allowlist, since none of them can be a DNS rebinding
// target.
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

// isAllowedHost reports whether host is always-allowed (isLocalHost) or
// matches one of the operator-configured allowed hostnames (config's
// allowed_hosts / --allowed-hosts / OTELOP_ALLOWED_HOSTS).
func isAllowedHost(host string, allowed []string) bool {
	if isLocalHost(host) {
		return true
	}
	h := hostnameOnly(host)
	if h == "" {
		return false
	}
	lower := strings.ToLower(h)
	for _, pattern := range allowed {
		if hostMatchesPattern(lower, pattern) {
			return true
		}
	}
	return false
}

// hostMatchesPattern reports whether host (already lowercased, with any port
// stripped) matches pattern, a single allowed_hosts entry.
//
// A "*.example.com" pattern matches "example.com" itself and any depth of
// subdomain ("foo.example.com", "foo.bar.example.com", ...) — mirroring
// Vite's `server.allowedHosts` leading-dot wildcard (".example.com" allows
// "example.com", "foo.example.com", and "foo.bar.example.com" alike), which
// operators reaching for this otelop setting are likely already familiar
// with from the frontend dev server. Arbitrary depth also avoids operators
// needing a separate allowed_hosts entry per subdomain level. Anything else
// is a case-insensitive exact match.
func hostMatchesPattern(host, pattern string) bool {
	pattern = strings.ToLower(strings.TrimSpace(pattern))
	if pattern == "" {
		return false
	}
	suffix, ok := strings.CutPrefix(pattern, "*.")
	if !ok {
		return host == pattern
	}
	return host == suffix || strings.HasSuffix(host, "."+suffix)
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
