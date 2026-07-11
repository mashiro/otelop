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

// logsPageQuery's count(*) OVER () rides along as total_count: since this
// query has no GROUP BY, every row already carries the same window-wide
// count — the same "matching logs before pagination" total logsTotalQuery
// computes separately — letting LogsPage read it off the page query itself
// instead of a second round trip (see LogsPage's doc comment).
const logsPageQuery = `
SELECT ` + logSelectColumns + `, count(*) OVER () AS total_count
FROM logs l
JOIN resources r ON r.resource_hash = l.resource_hash
WHERE l.ts >= ? AND l.ts < ?
AND ` + searchPredicate + `
ORDER BY l.ts DESC
LIMIT ? OFFSET ?
`

// logsTotalQuery mirrors logsPageQuery's filtering exactly so `total`
// reflects the same search-narrowed log set the page itself pages through.
// It's no longer LogsPage's normal path to `total` (that's logsPageQuery's
// own count(*) OVER () column) — this only runs as the
// empty-page-with-offset fallback, via queryCount, when offset lands past
// the end of the matching set.
const logsTotalQuery = `
SELECT count(*)
FROM logs l
JOIN resources r ON r.resource_hash = l.resource_hash
WHERE l.ts >= ? AND l.ts < ?
AND ` + searchPredicate

// LogsPage returns a newest-first page of logs within [from, to) that, when
// search is non-empty, also match it (see searchPredicate), plus the total
// matching count. total is read off the page query's own count(*) OVER ()
// column; when the page comes back empty because offset is past the end of
// the matching set, that column has nothing to report, so a separate
// logsTotalQuery run recovers it (see queryCount).
func (s *Storage) LogsPage(ctx context.Context, from, to time.Time, offset, limit int, search string) ([]LogDetail, int, error) {
	pattern := likePattern(search)

	rows, err := s.DB().QueryContext(ctx, logsPageQuery, from, to, pattern, pattern, pattern, pattern, pageLimit(limit), offset)
	if err != nil {
		return nil, 0, fmt.Errorf("storage: query logs page: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items, total, err := scanLogRowsWithTotal(rows)
	if err != nil {
		return nil, 0, err
	}

	if len(items) == 0 && offset > 0 {
		total, err = s.queryCount(ctx, logsTotalQuery, from, to, pattern, pattern, pattern, pattern)
		if err != nil {
			return nil, 0, fmt.Errorf("storage: count logs page: %w", err)
		}
	}

	return items, total, nil
}

// logsPageByTraceIDQuery's count(*) OVER () is logsPageQuery's counterpart
// for the trace-correlation view — see LogsPage's doc comment.
const logsPageByTraceIDQuery = `
SELECT ` + logSelectColumns + `, count(*) OVER () AS total_count
FROM logs l
JOIN resources r ON r.resource_hash = l.resource_hash
WHERE l.trace_id = ?
ORDER BY l.ts DESC
LIMIT ? OFFSET ?
`

// logsTotalByTraceIDQuery is logsPageByTraceID's empty-page-with-offset
// fallback (see LogsPage's doc comment on the same pattern).
const logsTotalByTraceIDQuery = `SELECT count(*) FROM logs WHERE trace_id = ?`

// LogsPageByTraceID returns a newest-first page of logs correlated to
// traceID. Unlike LogsPage it takes no time range — matching
// the old store package's GetLogsPageByTraceID, which looks up its secondary index
// by trace_id alone regardless of when the logs arrived.
func (s *Storage) LogsPageByTraceID(ctx context.Context, traceID string, offset, limit int) ([]LogDetail, int, error) {
	rows, err := s.DB().QueryContext(ctx, logsPageByTraceIDQuery, traceID, pageLimit(limit), offset)
	if err != nil {
		return nil, 0, fmt.Errorf("storage: query logs by trace: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items, total, err := scanLogRowsWithTotal(rows)
	if err != nil {
		return nil, 0, err
	}

	if len(items) == 0 && offset > 0 {
		total, err = s.queryCount(ctx, logsTotalByTraceIDQuery, traceID)
		if err != nil {
			return nil, 0, fmt.Errorf("storage: count logs by trace: %w", err)
		}
	}

	return items, total, nil
}

// logRows is the subset of *sql.Rows methods scanLogRowsWithTotal needs, so
// it works for both LogsPage and LogsPageByTraceID's row sets.
type logRows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}

// scanLogRowsWithTotal scans every row of a logsPageQuery/logsPageByTraceIDQuery
// result, including each row's trailing total_count column (see those
// queries' doc comments) — total is 0 (not meaningful) when items is empty,
// since count(*) OVER () has nothing to report over zero rows; callers fall
// back to a count-only query in that case.
func scanLogRowsWithTotal(rows logRows) ([]LogDetail, int, error) {
	items := make([]LogDetail, 0)
	var total int
	for rows.Next() {
		var (
			l                     LogDetail
			id                    duckdb.UUID
			attrsRaw, resourceRaw *string
			totalCount            int
		)
		if err := rows.Scan(
			&id, &l.TS, &l.ObservedTS, &l.TraceID, &l.SpanID, &l.SeverityNumber, &l.SeverityText, &l.Body,
			&attrsRaw, &l.ServiceName, &resourceRaw, &totalCount,
		); err != nil {
			return nil, 0, fmt.Errorf("storage: scan log detail: %w", err)
		}
		total = totalCount
		l.ID = uuid.UUID(id)
		attrs, err := decodeAttrs(attrsRaw)
		if err != nil {
			return nil, 0, err
		}
		l.Attributes = attrs
		resource, err := decodeAttrs(resourceRaw)
		if err != nil {
			return nil, 0, err
		}
		l.Resource = resource
		items = append(items, l)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("storage: iterate log rows: %w", err)
	}
	return items, total, nil
}
