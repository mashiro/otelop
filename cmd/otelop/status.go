package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/mashiro/otelop/internal/daemon"
)

func statusCommand() *cli.Command {
	return &cli.Command{
		Name:   "status",
		Usage:  "Show whether otelop is running and what it is listening on",
		Action: runStatus,
	}
}

// statusPayload mirrors the Status type in internal/graphql/schema.graphql.
// Keep field names in sync when the schema changes.
type statusPayload struct {
	Version       string    `json:"version"`
	StartedAt     time.Time `json:"startedAt"`
	UptimeMs      float64   `json:"uptimeMs"`
	HTTPAddr      string    `json:"httpAddr"`
	OTLPGrpcAddr  string    `json:"otlpGrpcAddr"`
	OTLPHTTPAddr  string    `json:"otlpHttpAddr"`
	ProxyURL      string    `json:"proxyUrl"`
	ProxyProtocol string    `json:"proxyProtocol"`
	Debug         bool      `json:"debug"`
	Config        struct {
		TraceCount  int32 `json:"traceCount"`
		MetricCount int32 `json:"metricCount"`
		LogCount    int32 `json:"logCount"`
		TraceCap    int32 `json:"traceCap"`
		MetricCap   int32 `json:"metricCap"`
		LogCap      int32 `json:"logCap"`
	} `json:"config"`
}

const statusQuery = `{
  status {
    version
    startedAt
    uptimeMs
    httpAddr
    otlpGrpcAddr
    otlpHttpAddr
    proxyUrl
    proxyProtocol
    debug
    config {
      traceCount
      metricCount
      logCount
      traceCap
      metricCap
      logCap
    }
  }
}`

func runStatus(ctx context.Context, cmd *cli.Command) error {
	meta, running, err := daemon.Running()
	if err != nil {
		return err
	}
	w := cmd.Writer
	if meta == nil {
		_, _ = fmt.Fprintln(w, "otelop is not running")
		return nil
	}
	if !running {
		_, _ = fmt.Fprintf(w, "otelop is not running (stale metadata for pid %d; run `otelop stop` to clean up)\n", meta.PID)
		return nil
	}

	payload, queryErr := queryStatus(ctx, meta.HTTPAddr)
	if queryErr != nil {
		_, _ = fmt.Fprintf(w, "otelop is running (pid %d) — status query failed: %v\n", meta.PID, queryErr)
		printMetaOnly(w, meta)
		return nil
	}

	printFull(w, meta, payload)
	return nil
}

func queryStatus(ctx context.Context, httpAddr string) (*statusPayload, error) {
	endpoint, err := resolveLoopback(httpAddr)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(map[string]string{"query": statusQuery})
	if err != nil {
		return nil, err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, "http://"+endpoint+"/graphql", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", resp.Status, string(raw))
	}
	var envelope struct {
		Data struct {
			Status statusPayload `json:"status"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("decode graphql response: %w", err)
	}
	if len(envelope.Errors) > 0 {
		return nil, fmt.Errorf("graphql: %s", envelope.Errors[0].Message)
	}
	return &envelope.Data.Status, nil
}

func printFull(w io.Writer, meta *daemon.Metadata, s *statusPayload) {
	suffix := " is running"
	if s.Debug {
		suffix += " (debug)"
	}
	uptime := formatUptime(time.Duration(s.UptimeMs) * time.Millisecond)
	logFile, _ := daemon.LogFile()
	writeBanner(w, suffix, bannerRows{
		{"PID", strconv.Itoa(meta.PID)},
		{"Started", s.StartedAt.Local().Format(time.RFC3339) + " (up " + uptime + ")"},
		{"Web UI", "http://" + webUIDisplay(s.HTTPAddr)},
		{"OTLP gRPC", s.OTLPGrpcAddr},
		{"OTLP HTTP", s.OTLPHTTPAddr},
		{"Proxy", formatProxyStatus(s.ProxyURL, s.ProxyProtocol)},
		{"Buffered", fmt.Sprintf("traces=%d/%d metrics=%d/%d logs=%d/%d",
			s.Config.TraceCount, s.Config.TraceCap,
			s.Config.MetricCount, s.Config.MetricCap,
			s.Config.LogCount, s.Config.LogCap)},
		{"Log", logFile},
	})
}

func printMetaOnly(w io.Writer, meta *daemon.Metadata) {
	logFile, _ := daemon.LogFile()
	writeBanner(w, " is running", bannerRows{
		{"PID", strconv.Itoa(meta.PID)},
		{"Started", meta.StartedAt.Local().Format(time.RFC3339)},
		{"Web UI", "http://" + webUIDisplay(meta.HTTPAddr)},
		{"OTLP gRPC", meta.OTLPGRPCAddr},
		{"OTLP HTTP", meta.OTLPHTTPAddr},
		{"Proxy", formatProxyStatus(meta.ProxyURL, meta.ProxyProtocol)},
		{"Log", logFile},
	})
}

func formatUptime(d time.Duration) string {
	d = d.Round(time.Second)
	if d < time.Minute {
		return d.String()
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm%ds", int(d.Minutes()), int((d % time.Minute).Seconds()))
	}
	return fmt.Sprintf("%dh%dm", int(d.Hours()), int((d%time.Hour)/time.Minute))
}
