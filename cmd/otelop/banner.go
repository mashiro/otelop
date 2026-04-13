package main

import (
	"fmt"
	"io"
	"net"
)

const (
	colorCyanBold = "\033[1;36m"
	colorReset    = "\033[0m"
)

type bannerRow struct{ label, value string }
type bannerRows []bannerRow

func writeBanner(w io.Writer, suffix string, rows bannerRows) {
	_, _ = fmt.Fprintf(w, "  %sotelop%s%s\n\n", colorCyanBold, colorReset, suffix)
	for _, r := range rows {
		_, _ = fmt.Fprintf(w, "  %-14s %s\n", r.label, r.value)
	}
	_, _ = fmt.Fprintln(w)
}

// resolveLoopback converts a listen address (e.g. "0.0.0.0:4317") to a
// connectable loopback address (e.g. "localhost:4317"). Shared by the banner
// renderer, self-telemetry setup, and the GraphQL client so they all agree
// on what "localhost" means.
func resolveLoopback(listenAddr string) (string, error) {
	host, port, err := net.SplitHostPort(listenAddr)
	if err != nil {
		return "", err
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "localhost"
	}
	return host + ":" + port, nil
}

// webUIDisplay is resolveLoopback with an "on error, fall back to the raw
// address" safety net for cosmetic output where a parse error shouldn't
// replace the address with an empty string.
func webUIDisplay(addr string) string {
	display, err := resolveLoopback(addr)
	if err != nil {
		return addr
	}
	return display
}
