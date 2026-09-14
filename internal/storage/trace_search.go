package storage

import (
	"context"
	"fmt"
	"strings"
	"time"

	duckdb "github.com/duckdb/duckdb-go/v2"
)

var traceFieldColumns = map[string]string{
	"trace_id": "s.trace_id", "span_id": "s.span_id", "parent_span_id": "s.parent_span_id",
	"service_name": "r.service_name", "name": "s.name", "kind": "s.kind",
	"status_code": "s.status_code", "status_message": "s.status_message",
	"duration_ms": "((epoch_ns(s.end_ts) - epoch_ns(s.start_ts)) / 1000000.0)",
}

// All predicates belong to one EXISTS span, including negation. A negative
// attribute condition means a matching span lacks that value, not that every
// span in the trace lacks it.
func traceSearchSQL(search string) (string, []any) {
	plain, terms := parseSignalSearch(search, traceFieldColumns)
	predicate := "TRUE"
	var args []any
	if plain != "" {
		predicate = traceSearchPredicate
		for range 9 {
			args = append(args, likePattern(plain))
		}
	}
	for _, term := range terms {
		clause, values := signalAttributeSQL(term, "s.attributes", traceFieldColumns, map[string]bool{"duration_ms": true})
		if term.negated {
			clause = "NOT COALESCE((" + clause + "), FALSE)"
		}
		predicate += " AND (" + clause + ")"
		args = append(args, values...)
	}
	return predicate, args
}

// MatchingTraceIDs validates a bounded live batch without fetching span detail.
func (s *Storage) MatchingTraceIDs(ctx context.Context, ids []string, from, to time.Time, search string) ([]string, error) {
	matched := make([]string, 0)
	if len(ids) == 0 {
		return matched, nil
	}
	predicate, values := traceSearchSQL(search)
	placeholders := make([]string, len(ids))
	args := []any{duckdb.Typed(from, duckdb.TYPE_TIMESTAMP_NS), duckdb.Typed(to, duckdb.TYPE_TIMESTAMP_NS)}
	for i, id := range ids {
		placeholders[i] = "?"
		args = append(args, id)
	}
	args = append(args, values...)
	query := `SELECT t.trace_id FROM trace_summaries t WHERE t.start_ts >= ? AND t.start_ts < ? AND t.trace_id IN (` + strings.Join(placeholders, ",") + `) AND EXISTS (SELECT 1 FROM spans s JOIN resources r ON r.resource_hash = s.resource_hash WHERE s.trace_id = t.trace_id AND ` + predicate + `)`
	rows, err := s.DB().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("storage: match live traces: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		matched = append(matched, id)
	}
	return matched, rows.Err()
}
