// Package storage's read query layer (Phase 2 of docs/design/duckdb-storage.md).
//
// Every method here is read-only SQL over Storage.DB() — none of it touches
// the writer connection. Result types mirror the old store package's JSON-facing
// shapes (map[string]any attributes, time.Time, time.Duration) on purpose:
// Phase 3 swaps the GraphQL resolvers from *store.Store to *storage.Storage,
// and keeping the field shapes parallel makes that a mechanical rename rather
// than a rewrite.
//
// JSON columns (attributes, events, resource attributes) are cast to VARCHAR
// in SQL and decoded with encoding/json in Go, rather than relying on the
// duckdb-go driver's automatic JSON-column decoding (which eagerly unmarshals
// into generic map[string]any/[]any and loses struct-typed fields like a span
// event's time.Time — confirmed empirically against the driver before
// settling on this approach).
package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// decodeAttrs decodes a JSON-object column (cast to VARCHAR in SQL) into an
// attribute map. A NULL column (empty raw string) yields a nil map rather
// than an error — spans/logs/resources always carry a JSON attributes
// column, but it can be SQL NULL when no attributes were ever set.
func decodeAttrs(raw *string) (map[string]any, error) {
	if raw == nil {
		return nil, nil
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(*raw), &m); err != nil {
		return nil, fmt.Errorf("storage: decode attributes: %w", err)
	}
	return m, nil
}

// likeEscaper escapes DuckDB ILIKE's two wildcard metacharacters (% and _)
// plus the backslash escape character itself, so likePattern can build a
// literal-substring "contains" pattern from arbitrary user input (issue
// #161) — a search for "100%" must match the literal text "100%", not act
// as "100" followed by a wildcard. Every likePattern call must be paired
// with `ESCAPE '\'` in the surrounding SQL.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// likePattern turns a raw search string into a case-insensitive
// "contains" ILIKE pattern (`%escaped-search%`). An empty search yields "%%",
// which ILIKE matches against any value (including empty strings/NULLs would
// still need a NULL check elsewhere) — the caller's no-filter default.
func likePattern(search string) string {
	return "%" + likeEscaper.Replace(search) + "%"
}

// DBStats is per-table row counts plus file size, backing the status/config
// surface (Phase 3's GraphQL Config/Status resolvers).
type DBStats struct {
	Resources    int64
	MetricSeries int64
	Spans        int64
	MetricPoints int64
	Logs         int64
	// FileBacked reports whether this database has a file on disk. FileSizeBytes
	// is always 0 for an in-memory database.
	FileBacked    bool
	FileSizeBytes int64
}

// tableCount runs `SELECT count(*) FROM <table>`. table is always one of the
// fixed identifiers below (never user input), so string interpolation here
// carries no injection risk.
func tableCount(ctx context.Context, s *Storage, table string) (int64, error) {
	var n int64
	err := s.DB().QueryRowContext(ctx, `SELECT count(*) FROM `+table).Scan(&n) //nolint:gosec // table is a fixed internal identifier, never user input
	if err != nil {
		return 0, fmt.Errorf("storage: count %s: %w", table, err)
	}
	return n, nil
}

// DBStats reports per-table row counts and, for a file-backed database, the
// on-disk file size.
func (s *Storage) DBStats(ctx context.Context) (DBStats, error) {
	var stats DBStats
	for table, dst := range map[string]*int64{
		"resources":     &stats.Resources,
		"metric_series": &stats.MetricSeries,
		"spans":         &stats.Spans,
		"metric_points": &stats.MetricPoints,
		"logs":          &stats.Logs,
	} {
		n, err := tableCount(ctx, s, table)
		if err != nil {
			return DBStats{}, err
		}
		*dst = n
	}

	if s.opts.Path != "" {
		stats.FileBacked = true
		size, err := s.fileSize()
		if err != nil {
			return DBStats{}, fmt.Errorf("storage: stat database file: %w", err)
		}
		stats.FileSizeBytes = size
	}

	return stats, nil
}

// Counts reports the trace/metric/log counts used by the GraphQL Config
// surface: distinct traces (a trace_id group, not a raw span count), distinct
// (service, metric name) pairs (a metric group, not a raw data-point count),
// and raw log rows — matching the old store package's Store.Len() semantics, where
// each ring buffer holds one TraceData/MetricData/LogData per logical item.
func (s *Storage) Counts(ctx context.Context) (traces, metrics, logs int, err error) {
	if err := s.DB().QueryRowContext(ctx, `SELECT count(DISTINCT trace_id) FROM spans`).Scan(&traces); err != nil {
		return 0, 0, 0, fmt.Errorf("storage: count traces: %w", err)
	}
	err = s.DB().QueryRowContext(ctx, `
		SELECT count(*) FROM (
			SELECT 1 FROM metric_series GROUP BY service_name, metric_name
		)
	`).Scan(&metrics)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("storage: count metrics: %w", err)
	}
	if err := s.DB().QueryRowContext(ctx, `SELECT count(*) FROM logs`).Scan(&logs); err != nil {
		return 0, 0, 0, fmt.Errorf("storage: count logs: %w", err)
	}
	return traces, metrics, logs, nil
}
