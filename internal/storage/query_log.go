package storage

import (
	"context"
	"fmt"
	"time"

	duckdb "github.com/duckdb/duckdb-go/v2"
	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"
)

// LogDetail is one log record joined with its resource.
type LogDetail struct {
	ID             uuid.UUID
	TS             time.Time
	ObservedTS     time.Time
	TraceID        string
	SpanID         string
	SeverityNumber int32
	SeverityText   string
	Body           string
	Attributes     map[string]any
	ServiceName    string
	Resource       map[string]any
}

type LogCursor struct {
	TS time.Time
	ID uuid.UUID
}

const logSelectColumns = `
	l.id, l.ts, l.observed_ts, l.trace_id, l.span_id, l.severity_number, l.severity_text, l.body,
	l.attributes::VARCHAR, r.service_name, r.attributes::VARCHAR
`

// searchPredicate (issue #161) is the case-insensitive substring match:
// body, resource service name, severity text, or trace_id. An empty search's "%%" likePattern matches
// unconditionally, making this a no-op filter.
const searchPredicate = `
(
	l.body ILIKE ? ESCAPE '\' OR
	r.service_name ILIKE ? ESCAPE '\' OR
	l.severity_text ILIKE ? ESCAPE '\' OR
	l.trace_id ILIKE ? ESCAPE '\'
)
`

const logsPageQuery = `
SELECT ` + logSelectColumns + `
FROM logs l
JOIN resources r ON r.resource_hash = l.resource_hash
WHERE l.ts >= ? AND l.ts < ?
AND ` + searchPredicate + `
AND (CAST(? AS BOOLEAN) OR l.ts < ? OR (l.ts = ? AND l.id < ?))
ORDER BY l.ts DESC, l.id DESC
LIMIT ?
`

// LogsPage returns a newest-first page of logs within [from, to) that, when
// search is non-empty, also match it (see searchPredicate). It fetches one
// extra row to report whether another page exists without counting all matches.
func (s *Storage) LogsPage(ctx context.Context, from, to time.Time, after *LogCursor, limit int, search string) (items []LogDetail, hasNextPage bool, err error) {
	ctx, span := startStorageSpan(ctx, "storage.LogsPage", attribute.Int("db.limit", limit))
	defer func() { endStorageSpan(span, err) }()
	started := time.Now()
	defer func() { s.recordQuery(ctx, "query_logs", started, err) }()
	pattern := likePattern(search)

	queryLimit := pageLimit(limit)
	if limit > 0 {
		queryLimit++
	}
	firstPage, cursorTS, cursorID := logCursorArgs(after)
	rows, err := s.DB().QueryContext(ctx, logsPageQuery, from, to, pattern, pattern, pattern, pattern,
		firstPage, cursorTS, cursorTS, cursorID, queryLimit)
	if err != nil {
		return nil, false, fmt.Errorf("storage: query logs page: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items, err = scanLogRows(rows)
	if err != nil {
		return nil, false, err
	}
	if limit > 0 && len(items) > limit {
		hasNextPage = true
		items = items[:limit]
	}
	return items, hasNextPage, nil
}

const logsPageByTraceIDQuery = `
SELECT ` + logSelectColumns + `
FROM logs l
JOIN resources r ON r.resource_hash = l.resource_hash
WHERE l.trace_id = ?
AND ` + searchPredicate + `
AND (CAST(? AS BOOLEAN) OR l.ts < ? OR (l.ts = ? AND l.id < ?))
ORDER BY l.ts DESC, l.id DESC
LIMIT ?
`

// LogsPageByTraceID returns a newest-first page of logs correlated to
// traceID and optionally matching search. Unlike LogsPage it takes no time
// range: trace correlation is retained-history filtering regardless of when
// the logs arrived.
func (s *Storage) LogsPageByTraceID(ctx context.Context, traceID string, after *LogCursor, limit int, search string) (items []LogDetail, hasNextPage bool, err error) {
	ctx, span := startStorageSpan(ctx, "storage.LogsPageByTraceID", attribute.Int("db.limit", limit))
	defer func() { endStorageSpan(span, err) }()
	started := time.Now()
	defer func() { s.recordQuery(ctx, "query_logs_by_trace", started, err) }()
	queryLimit := pageLimit(limit)
	if limit > 0 {
		queryLimit++
	}
	firstPage, cursorTS, cursorID := logCursorArgs(after)
	pattern := likePattern(search)
	rows, err := s.DB().QueryContext(ctx, logsPageByTraceIDQuery, traceID,
		pattern, pattern, pattern, pattern,
		firstPage, cursorTS, cursorTS, cursorID, queryLimit)
	if err != nil {
		return nil, false, fmt.Errorf("storage: query logs by trace: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items, err = scanLogRows(rows)
	if err != nil {
		return nil, false, err
	}
	if limit > 0 && len(items) > limit {
		hasNextPage = true
		items = items[:limit]
	}
	return items, hasNextPage, nil
}

func logCursorArgs(after *LogCursor) (bool, time.Time, uuid.UUID) {
	if after == nil {
		return true, time.Unix(0, 0).UTC(), uuid.Nil
	}
	return false, after.TS, after.ID
}

// logRows is the subset of *sql.Rows methods scanLogRows needs, so
// it works for both LogsPage and LogsPageByTraceID's row sets.
type logRows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}

func scanLogRows(rows logRows) ([]LogDetail, error) {
	items := make([]LogDetail, 0)
	for rows.Next() {
		var (
			l                     LogDetail
			id                    duckdb.UUID
			attrsRaw, resourceRaw *string
		)
		if err := rows.Scan(
			&id, &l.TS, &l.ObservedTS, &l.TraceID, &l.SpanID, &l.SeverityNumber, &l.SeverityText, &l.Body,
			&attrsRaw, &l.ServiceName, &resourceRaw,
		); err != nil {
			return nil, fmt.Errorf("storage: scan log detail: %w", err)
		}
		l.ID = uuid.UUID(id)
		attrs, err := decodeAttrs(attrsRaw)
		if err != nil {
			return nil, err
		}
		l.Attributes = attrs
		resource, err := decodeAttrs(resourceRaw)
		if err != nil {
			return nil, err
		}
		l.Resource = resource
		items = append(items, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("storage: iterate log rows: %w", err)
	}
	return items, nil
}
