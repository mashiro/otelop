package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/urfave/cli/v3"

	"github.com/mashiro/otelop/internal/config"
	"github.com/mashiro/otelop/internal/daemon"
)

func infoCommand() *cli.Command {
	return &cli.Command{
		Name:   "info",
		Usage:  "Show effective configuration and storage details",
		Action: runInfo,
	}
}

func runInfo(ctx context.Context, cmd *cli.Command) error {
	meta, running, err := daemon.Running()
	if err != nil {
		return err
	}
	w := cmd.Writer

	if meta != nil {
		if running {
			payload, queryErr := queryStatus(ctx, meta.HTTPAddr)
			if queryErr == nil {
				return printInfoRunning(w, meta, payload)
			}
			_, _ = fmt.Fprintf(w, "otelop is running (pid %d) — status query failed: %v\n", meta.PID, queryErr)
		} else {
			_, _ = fmt.Fprintf(w, "otelop is not running (stale metadata for pid %d; run `otelop stop` to clean up)\n", meta.PID)
		}
	}

	return printInfoResolved(w)
}

// printInfoRunning renders the effective configuration as reported live by a
// running instance (via the same `status` GraphQL query `otelop status`
// uses). Row counts are only meaningful here — a not-running instance would
// require opening the DB file to compute them, which a running instance may
// already hold open.
func printInfoRunning(w io.Writer, meta *daemon.Metadata, s *statusPayload) error {
	cfgDisplay, err := resolveConfigPathDisplay()
	if err != nil {
		return err
	}
	dbSize := "(in-memory)"
	if s.Config.StoragePath != "" {
		dbSize = formatBytes(s.DBSizeBytes)
	}
	writeBanner(w, fmt.Sprintf(" info — from running instance (pid %d)", meta.PID), bannerRows{
		{"Config file", cfgDisplay},
		{"Web UI", "http://" + webUIDisplay(s.HTTPAddr)},
		{"OTLP gRPC", s.OTLPGrpcAddr},
		{"OTLP HTTP", s.OTLPHTTPAddr},
		{"Proxy", formatProxyOrNone(s.ProxyURL, s.ProxyProtocol)},
		{"Log level", s.LogLevel},
		{"Debug", strconv.FormatBool(s.Debug)},
		{"Storage path", s.Config.StoragePath},
		{"Retention", s.Config.Retention},
		{"Max size", s.Config.MaxSize},
		{"DB size", dbSize},
		{"Counts", fmt.Sprintf("traces=%d metrics=%d logs=%d", s.Config.TraceCount, s.Config.MetricCount, s.Config.LogCount)},
	})
	return nil
}

// printInfoResolved renders the effective configuration as locally resolved
// from the TOML config file plus built-in defaults — used when no instance
// is running (or its status query failed). Row counts are omitted: getting
// them would mean opening the DB file ourselves, which risks colliding with
// a database an instance we couldn't reach is still holding open.
func printInfoResolved(w io.Writer) error {
	cfg, cfgPath, err := config.Load()
	if err != nil {
		return err
	}
	cfgDisplay := cfgPath
	if !fileExists(cfgPath) {
		cfgDisplay = cfgPath + " (not found)"
	}

	storagePath := cfg.Storage.Path
	if storagePath == "" {
		storagePath, err = config.DefaultStoragePath()
		if err != nil {
			return err
		}
	}

	dbSize := "(no database yet)"
	if fi, statErr := os.Stat(storagePath); statErr == nil {
		dbSize = formatBytes(float64(fi.Size()))
	}

	writeBanner(w, " info — resolved from config (instance not running)", bannerRows{
		{"Config file", cfgDisplay},
		{"Web UI", "http://" + webUIDisplay(cfg.HTTPAddr)},
		{"OTLP gRPC", cfg.OTLPGRPCAddr},
		{"OTLP HTTP", cfg.OTLPHTTPAddr},
		{"Proxy", formatProxyOrNone(cfg.Proxy.URL, cfg.Proxy.Protocol)},
		{"Log level", cfg.LogLevel},
		{"Debug", strconv.FormatBool(cfg.Debug)},
		{"Storage path", storagePath},
		{"Retention", cfg.Storage.Retention},
		{"Max size", cfg.Storage.MaxSize},
		{"DB size", dbSize},
	})
	return nil
}

// resolveConfigPathDisplay resolves the config file path `info` would read
// (honouring OTELOP_CONFIG_FILE, same as config.Load) and annotates it when
// the file doesn't exist. Used in running-instance mode too: the path is a
// property of the environment `otelop info` runs in, independent of what the
// already-running instance was started with.
func resolveConfigPathDisplay() (string, error) {
	path, err := config.DefaultPath()
	if err != nil {
		return "", err
	}
	if !fileExists(path) {
		return path + " (not found)", nil
	}
	return path, nil
}

// fileExists reports whether path exists, folding away os.Stat's error
// (permission errors included — this is cosmetic display, not a correctness
// check) so callers don't shadow an unrelated `err` in scope.
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// formatProxyOrNone mirrors formatProxyStatus's shape but with the "(none)"
// fallback `otelop info`'s design calls for, distinct from status's
// "disabled" wording.
func formatProxyOrNone(proxyURL, proxyProtocol string) string {
	if proxyURL == "" || proxyProtocol == "" {
		return "(none)"
	}
	return fmt.Sprintf("%s %s", strings.ToUpper(proxyProtocol), proxyURL)
}
