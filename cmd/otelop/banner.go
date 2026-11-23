package main

import (
	"fmt"
	"io"
	"strings"

	"github.com/mashiro/otelop/internal/daemon"
	"github.com/mashiro/otelop/internal/netutil"
	otelruntime "github.com/mashiro/otelop/internal/runtime"
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

// exporterRows renders one banner row per upstream exporter, labeling only
// the first. The fallback text differs by caller: `start`/`status` use
// "disabled" (an operational state), `info` uses "(none)" (a config value
// that's simply unset).
func exporterRows(exporters []daemon.Exporter, fallback string) bannerRows {
	return exporterRowsWith(len(exporters), fallback, func(i int) string {
		return formatExporter(exporters[i])
	})
}

func exporterRowsWith(n int, fallback string, format func(int) string) bannerRows {
	if n == 0 {
		return bannerRows{{"Exporters", fallback}}
	}
	rows := make(bannerRows, n)
	for i := range n {
		label := ""
		if i == 0 {
			label = "Exporters"
		}
		rows[i] = bannerRow{label, format(i)}
	}
	return rows
}

func formatExporter(e daemon.Exporter) string {
	return fmt.Sprintf("%s: %s %s", e.Name, strings.ToUpper(e.Protocol), e.URL)
}

// exporterSummaries is what start/status display and persist: credentials
// are redacted and auth settings are left out.
func exporterSummaries(exporters []otelruntime.ExporterOptions) []daemon.Exporter {
	out := make([]daemon.Exporter, len(exporters))
	for i, e := range exporters {
		out[i] = daemon.Exporter{Name: e.Name, URL: otelruntime.RedactURL(e.URL), Protocol: e.Protocol}
	}
	return out
}
