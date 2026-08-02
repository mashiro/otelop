package main

import (
	"fmt"
	"io"

	"github.com/mashiro/otelop/internal/netutil"
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

// webUIDisplay is netutil.Loopback with an "on error, fall back to the raw
// address" safety net for cosmetic output where a parse error shouldn't
// replace the address with an empty string.
func webUIDisplay(addr string) string {
	display, err := netutil.Loopback(addr)
	if err != nil {
		return addr
	}
	return display
}
