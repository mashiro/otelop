package storage

import (
	"context"
	"fmt"
	"time"

	duckdb "github.com/duckdb/duckdb-go/v2"
	"github.com/google/uuid"
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

const logSelectColumns = `
	l.id, l.ts, l.observed_ts, l.trace_id, l.span_id, l.severity_number, l.severity_text, l.body,
	l.attributes::VARCHAR, r.service_name, r.attributes::VARCHAR
`

// searchPredicate (issue #161) is the case-insensitive substring match
// shared by logsPageQuery/logsTotalQuery: body, resource service name,
// severity text, or trace_id. An empty search's "%%" likePattern matches
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
ORDER BY l.ts DESC
LIMIT ? OFFSET ?
`

const logsTotalQuery = `
SELECT count(*)
FROM logs l
JOIN resources r ON r.resource_hash = l.resource_hash
WHERE l.ts >= ? AND l.ts < ?
AND ` + searchPredicate

// LogsPage returns a newest-first page of logs within [from, to) that, when
// search is non-empty, also match it (see searchPredicate), plus the total
// matching count.
func (s *Storage) LogsPage(ctx context.Context, from, to time.Time, offset, limit int, search string) ([]LogDetail, int, error) {
	pattern := likePattern(search)

	var total int
	if err := s.DB().QueryRowContext(ctx, logsTotalQuery, from, to, pattern, pattern, pattern, pattern).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("storage: count logs page: %w", err)
	}

	rows, err := s.DB().QueryContext(ctx, logsPageQuery, from, to, pattern, pattern, pattern, pattern, pageLimit(limit), offset)
	if err != nil {
		return nil, 0, fmt.Errorf("storage: query logs page: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items, err := scanLogRows(rows)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

const logsPageByTraceIDQuery = `
SELECT ` + logSelectColumns + `
FROM logs l
JOIN resources r ON r.resource_hash = l.resource_hash
WHERE l.trace_id = ?
ORDER BY l.ts DESC
LIMIT ? OFFSET ?
`

const logsTotalByTraceIDQuery = `SELECT count(*) FROM logs WHERE trace_id = ?`

// LogsPageByTraceID returns a newest-first page of logs correlated to
// traceID. Unlike LogsPage it takes no time range — matching
// the old store package's GetLogsPageByTraceID, which looks up its secondary index
// by trace_id alone regardless of when the logs arrived.
func (s *Storage) LogsPageByTraceID(ctx context.Context, traceID string, offset, limit int) ([]LogDetail, int, error) {
	var total int
	if err := s.DB().QueryRowContext(ctx, logsTotalByTraceIDQuery, traceID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("storage: count logs by trace: %w", err)
	}

	rows, err := s.DB().QueryContext(ctx, logsPageByTraceIDQuery, traceID, pageLimit(limit), offset)
	if err != nil {
		return nil, 0, fmt.Errorf("storage: query logs by trace: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items, err := scanLogRows(rows)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// logRows is the subset of *sql.Rows methods scanLogRows needs, so it works
// for both LogsPage and LogsPageByTraceID's row sets.
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
