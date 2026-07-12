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
)

func infoCommand() *cli.Command {
	return &cli.Command{
		Name:   "info",
		Usage:  "Show configuration",
		Action: runInfo,
	}
}

func runInfo(_ context.Context, cmd *cli.Command) error {
	return printInfoResolved(cmd.Writer)
}

// printInfoResolved renders the configuration resolved from the TOML file and
// built-in defaults. It deliberately does not inspect a running instance or
// the database; runtime information belongs to `otelop status`.
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

	writeBanner(w, " info — configuration", bannerRows{
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
	})
	return nil
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
