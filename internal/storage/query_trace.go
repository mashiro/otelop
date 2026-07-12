package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// TraceSummary is the aggregated view of one trace — the declarative
// equivalent of the old store package's TraceData.Merge: span dedup, root
// selection, and the full-range Duration are all recomputed from the spans
// table rather than maintained incrementally.
type TraceSummary struct {
	TraceID     string
	StartTime   time.Time
	FirstSeen   time.Time
	Duration    time.Duration
	SpanCount   int
	HasError    bool
	ServiceName string

	// HasRoot is false when the trace has no parentless span (parent_span_id
	// = ''), matching the old store package's "rootless trace" case — the Root*
	// fields are the zero value in that case and must not be read.
	HasRoot        bool
	RootName       string
	RootKind       string
	RootStatusCode string
	RootDuration   time.Duration
}

type TraceCursor struct {
	StartTime time.Time
	FirstSeen time.Time
	TraceID   string
}

// SpanEventRow is reused for the decoded shape of a span's events JSON
// column — see convert.go, which produces the same shape at ingest.

// SpanDetail is one span joined with its resource, as returned by
// TraceByID/TracesPage detail queries.
type SpanDetail struct {
	TraceID       string
	SpanID        string
	ParentSpanID  string
	Name          string
	Kind          string
	StartTS       time.Time
	EndTS         time.Time
	Duration      time.Duration
	StatusCode    string
	StatusMessage string
	Attributes    map[string]any
	Events        []SpanEventRow
	ServiceName   string
	Resource      map[string]any
}

// TraceDetail is a trace summary plus every one of its (deduped) spans,
// ordered by start time.
type TraceDetail struct {
	TraceSummary
	Spans []SpanDetail
}

// traceSearchPredicate (issue #161) is the case-insensitive substring match
// used by tracesPageQuery's search_ids CTE: trace_id, span name, status code, or resource
// service name — the same field set the frontend's pre-#161 client-side
// filter searched (status included: searching "error" surfaces error
// traces). An empty search's "%%" pattern (see likePattern) matches
// unconditionally, making this a no-op filter.
const traceSearchPredicate = `
(
	s.trace_id ILIKE ? ESCAPE '\' OR
	s.name ILIKE ? ESCAPE '\' OR
	s.status_code ILIKE ? ESCAPE '\' OR
	r.service_name ILIKE ? ESCAPE '\'
)
`

// tracesPageQuery scopes the trace list by each trace's start time (the
// earliest span start), matching the timestamp rendered for that trace in
// the UI. Every later CTE still aggregates over the full deduped span set.
//
// search_ids narrows matching_ids further by traceSearchPredicate: a trace
// matches if ANY of its spans (regardless of whether that particular span
// itself falls in [from, to) — same full-span-set philosophy as the
// straddling-range case above) matches. It's a separate CTE (rather than
// folding the predicate into matching_ids) so the search join only runs over
// the already time-bounded trace_id set, not every span in the table.
//
// Root selection (root_candidates/roots) and the rootless fallback
// (earliest_candidates/earliest) are separate CTEs — each producing exactly
// one row per trace_id via row_number() — rather than several independent
// arg_max() calls, because arg_max() breaks ties independently per call and
// could pick fields from two different "longest root" spans when durations
// tie. row_number() with an explicit, deterministic tiebreak (span_id)
// guarantees every Root* field comes from the same chosen row.
//
// page_ids applies keyset pagination before the expensive dedupe, summary, and
// root-selection work. It requests limit+1 IDs; the extra row becomes
// hasNextPage and is not returned. This keeps an All-window page bounded
// even when tens of thousands of traces match.
const tracesPageQuery = `
WITH trace_starts AS (
	SELECT trace_id, min(start_ts) AS start_time, min(ingested_at) AS first_seen
	FROM spans
	GROUP BY trace_id
),
matching_ids AS (
	SELECT trace_id, start_time, first_seen
	FROM trace_starts WHERE start_time >= ? AND start_time < ?
),
search_ids AS (
	SELECT DISTINCT m.trace_id, m.start_time, m.first_seen
	FROM spans s
	JOIN matching_ids m ON m.trace_id = s.trace_id
	JOIN resources r ON r.resource_hash = s.resource_hash
	WHERE ` + traceSearchPredicate + `
),
page_ids AS (
	SELECT trace_id, start_time, first_seen
	FROM search_ids
	WHERE (CAST(? AS BOOLEAN) OR start_time < ?
		OR (start_time = ? AND first_seen < ?)
		OR (start_time = ? AND first_seen = ? AND trace_id < ?))
	ORDER BY start_time DESC, first_seen DESC, trace_id DESC
	LIMIT ?
),
deduped AS (
	SELECT * FROM spans
	WHERE trace_id IN (SELECT trace_id FROM page_ids)
	QUALIFY row_number() OVER (PARTITION BY trace_id, span_id ORDER BY ingested_at) = 1
),
agg AS (
	SELECT
		trace_id,
		min(start_ts)                  AS start_time,
		max(end_ts)                    AS end_time,
		count(*)                       AS span_count,
		bool_or(status_code = 'Error') AS has_error,
		min(ingested_at)               AS first_seen
	FROM deduped
	GROUP BY trace_id
),
root_candidates AS (
	SELECT
		trace_id, name, kind, status_code, start_ts, end_ts, resource_hash,
		row_number() OVER (
			PARTITION BY trace_id ORDER BY (end_ts - start_ts) DESC, span_id
		) AS rn
	FROM deduped
	WHERE parent_span_id = ''
),
roots AS (
	SELECT
		trace_id,
		name          AS root_name,
		kind          AS root_kind,
		status_code   AS root_status_code,
		start_ts      AS root_start_ts,
		end_ts        AS root_end_ts,
		resource_hash AS root_resource_hash
	FROM root_candidates
	WHERE rn = 1
),
earliest_candidates AS (
	SELECT
		trace_id, resource_hash,
		row_number() OVER (PARTITION BY trace_id ORDER BY start_ts, span_id) AS rn
	FROM deduped
),
earliest AS (
	SELECT trace_id, resource_hash AS earliest_resource_hash
	FROM earliest_candidates
	WHERE rn = 1
)
SELECT
	agg.trace_id, agg.start_time, agg.end_time, agg.span_count, agg.has_error, agg.first_seen,
	COALESCE(root_res.service_name, earliest_res.service_name) AS service_name,
	roots.root_name, roots.root_kind, roots.root_status_code, roots.root_start_ts, roots.root_end_ts
FROM agg
LEFT JOIN roots USING (trace_id)
LEFT JOIN earliest USING (trace_id)
LEFT JOIN resources root_res ON root_res.resource_hash = roots.root_resource_hash
LEFT JOIN resources earliest_res ON earliest_res.resource_hash = earliest.earliest_resource_hash
ORDER BY agg.start_time DESC, agg.first_seen DESC, agg.trace_id DESC
`

// TracesPage returns a newest-first (by trace start time) page of trace
// summaries whose start time is within [from, to) and, when search is
// non-empty, matches it (see tracesPageQuery's search_ids doc comment),
// plus whether another page exists. At most limit+1 traces receive full
// summary/root aggregation; the extra row is removed before returning.
func (s *Storage) TracesPage(ctx context.Context, from, to time.Time, after *TraceCursor, limit int, search string) (items []TraceSummary, hasNextPage bool, err error) {
	started := time.Now()
	defer func() { s.recordQuery(ctx, "query_traces", started, err) }()
	pattern := likePattern(search)

	queryLimit := pageLimit(limit)
	if limit > 0 {
		queryLimit++
	}
	firstPage, cursorStart, cursorSeen, cursorID := traceCursorArgs(after)
	rows, err := s.DB().QueryContext(ctx, tracesPageQuery, from, to, pattern, pattern, pattern, pattern,
		firstPage, cursorStart, cursorStart, cursorSeen, cursorStart, cursorSeen, cursorID, queryLimit)
	if err != nil {
		return nil, false, fmt.Errorf("storage: query traces page: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items = make([]TraceSummary, 0)
	for rows.Next() {
		var (
			t                                  TraceSummary
			endTime                            time.Time
			rootName, rootKind, rootStatusCode sql.NullString
			rootStartTS, rootEndTS             sql.NullTime
		)
		if err := rows.Scan(
			&t.TraceID, &t.StartTime, &endTime, &t.SpanCount, &t.HasError, &t.FirstSeen,
			&t.ServiceName, &rootName, &rootKind, &rootStatusCode, &rootStartTS, &rootEndTS,
		); err != nil {
			return nil, false, fmt.Errorf("storage: scan trace summary: %w", err)
		}
		t.Duration = endTime.Sub(t.StartTime)
		if rootStartTS.Valid {
			t.HasRoot = true
			t.RootName = rootName.String
			t.RootKind = rootKind.String
			t.RootStatusCode = rootStatusCode.String
			t.RootDuration = rootEndTS.Time.Sub(rootStartTS.Time)
		}
		items = append(items, t)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("storage: iterate traces page: %w", err)
	}
	if limit > 0 && len(items) > limit {
		hasNextPage = true
		items = items[:limit]
	}
	return items, hasNextPage, nil
}

func traceCursorArgs(after *TraceCursor) (bool, time.Time, time.Time, string) {
	if after == nil {
		epoch := time.Unix(0, 0).UTC()
		return true, epoch, epoch, ""
	}
	return false, after.StartTime, after.FirstSeen, after.TraceID
}

const traceSummariesByIDsQuery = `
WITH requested(trace_id) AS (VALUES %s),
deduped AS (
	SELECT s.*
	FROM spans s
	JOIN requested r USING (trace_id)
	QUALIFY row_number() OVER (PARTITION BY s.trace_id, s.span_id ORDER BY s.ingested_at) = 1
),
agg AS (
	SELECT
		trace_id,
		min(start_ts)                  AS start_time,
		max(end_ts)                    AS end_time,
		count(*)                       AS span_count,
		bool_or(status_code = 'Error') AS has_error
	FROM deduped
	GROUP BY trace_id
),
root_candidates AS (
	SELECT
		trace_id, name, kind, status_code, start_ts, end_ts, resource_hash,
		row_number() OVER (
			PARTITION BY trace_id ORDER BY (end_ts - start_ts) DESC, span_id
		) AS rn
	FROM deduped
	WHERE parent_span_id = ''
),
roots AS (
	SELECT
		trace_id,
		name          AS root_name,
		kind          AS root_kind,
		status_code   AS root_status_code,
		start_ts      AS root_start_ts,
		end_ts        AS root_end_ts,
		resource_hash AS root_resource_hash
	FROM root_candidates
	WHERE rn = 1
),
earliest_candidates AS (
	SELECT
		trace_id, resource_hash,
		row_number() OVER (PARTITION BY trace_id ORDER BY start_ts, span_id) AS rn
	FROM deduped
),
earliest AS (
	SELECT trace_id, resource_hash AS earliest_resource_hash
	FROM earliest_candidates
	WHERE rn = 1
)
SELECT
	agg.trace_id, agg.start_time, agg.end_time, agg.span_count, agg.has_error,
	COALESCE(root_res.service_name, earliest_res.service_name) AS service_name,
	roots.root_name, roots.root_kind, roots.root_status_code, roots.root_start_ts, roots.root_end_ts
FROM agg
LEFT JOIN roots USING (trace_id)
LEFT JOIN earliest USING (trace_id)
LEFT JOIN resources root_res ON root_res.resource_hash = roots.root_resource_hash
LEFT JOIN resources earliest_res ON earliest_res.resource_hash = earliest.earliest_resource_hash
`

// TraceSummariesByIDs returns current summaries for all requested traces in a
// single SQL round trip. Broadcast uses this after a commit: list updates need
// aggregate fields, not every span's JSON-heavy detail.
func (s *Storage) TraceSummariesByIDs(ctx context.Context, traceIDs []string) (items []TraceSummary, err error) {
	if len(traceIDs) == 0 {
		return []TraceSummary{}, nil
	}
	started := time.Now()
	defer func() { s.recordQuery(ctx, "query_trace_summaries", started, err) }()

	values := make([]string, len(traceIDs))
	args := make([]any, len(traceIDs))
	for i, id := range traceIDs {
		values[i] = "(?)"
		args[i] = id
	}
	query := fmt.Sprintf(traceSummariesByIDsQuery, strings.Join(values, ","))
	rows, err := s.DB().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("storage: query trace summaries: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items = make([]TraceSummary, 0, len(traceIDs))
	for rows.Next() {
		var (
			t                                  TraceSummary
			endTime                            time.Time
			rootName, rootKind, rootStatusCode sql.NullString
			rootStartTS, rootEndTS             sql.NullTime
		)
		if err := rows.Scan(
			&t.TraceID, &t.StartTime, &endTime, &t.SpanCount, &t.HasError,
			&t.ServiceName, &rootName, &rootKind, &rootStatusCode, &rootStartTS, &rootEndTS,
		); err != nil {
			return nil, fmt.Errorf("storage: scan trace summary: %w", err)
		}
		t.Duration = endTime.Sub(t.StartTime)
		if rootName.Valid {
			t.HasRoot = true
			t.RootName = rootName.String
			t.RootKind = rootKind.String
			t.RootStatusCode = rootStatusCode.String
			t.RootDuration = rootEndTS.Time.Sub(rootStartTS.Time)
		}
		items = append(items, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("storage: iterate trace summaries: %w", err)
	}
	return items, nil
}

const traceSpansQuery = `
WITH deduped AS (
	SELECT * FROM spans
	WHERE trace_id = ?
	QUALIFY row_number() OVER (PARTITION BY trace_id, span_id ORDER BY ingested_at) = 1
)
SELECT
	d.trace_id, d.span_id, d.parent_span_id, d.name, d.kind, d.start_ts, d.end_ts,
	d.status_code, d.status_message, d.attributes::VARCHAR, d.events::VARCHAR,
	r.service_name, r.attributes::VARCHAR
FROM deduped d
JOIN resources r ON r.resource_hash = d.resource_hash
ORDER BY d.start_ts
`

// TraceByID returns every (deduped) span of one trace, ordered by start
// time, plus the same summary fields TracesPage computes. ok is false when
// no spans exist for traceID.
func (s *Storage) TraceByID(ctx context.Context, traceID string) (detail *TraceDetail, found bool, err error) {
	started := time.Now()
	defer func() { s.recordQuery(ctx, "query_trace", started, err) }()
	s.traceByIDCalls.Add(1)
	rows, err := s.DB().QueryContext(ctx, traceSpansQuery, traceID)
	if err != nil {
		return nil, false, fmt.Errorf("storage: query trace spans: %w", err)
	}
	defer func() { _ = rows.Close() }()

	spans := make([]SpanDetail, 0)
	for rows.Next() {
		var (
			sp                  SpanDetail
			attrsRaw, eventsRaw *string
			resourceRaw         *string
		)
		if err := rows.Scan(
			&sp.TraceID, &sp.SpanID, &sp.ParentSpanID, &sp.Name, &sp.Kind, &sp.StartTS, &sp.EndTS,
			&sp.StatusCode, &sp.StatusMessage, &attrsRaw, &eventsRaw,
			&sp.ServiceName, &resourceRaw,
		); err != nil {
			return nil, false, fmt.Errorf("storage: scan span detail: %w", err)
		}
		sp.Duration = sp.EndTS.Sub(sp.StartTS)
		attrs, err := decodeAttrs(attrsRaw)
		if err != nil {
			return nil, false, err
		}
		sp.Attributes = attrs
		resource, err := decodeAttrs(resourceRaw)
		if err != nil {
			return nil, false, err
		}
		sp.Resource = resource
		events, err := decodeSpanEvents(eventsRaw)
		if err != nil {
			return nil, false, err
		}
		sp.Events = events
		spans = append(spans, sp)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("storage: iterate trace spans: %w", err)
	}
	if len(spans) == 0 {
		return nil, false, nil
	}

	detail = &TraceDetail{
		TraceSummary: summarizeSpans(traceID, spans),
		Spans:        spans,
	}
	return detail, true, nil
}

// decodeSpanEvents decodes a spans.events JSON column (cast to VARCHAR),
// reusing SpanEventRow's json tags so a time.Time round-trips through its
// RFC3339Nano encoding rather than the driver's generic JSON-to-any decoding
// (which would leave Timestamp as a plain string).
func decodeSpanEvents(raw *string) ([]SpanEventRow, error) {
	if raw == nil {
		return nil, nil
	}
	var events []SpanEventRow
	if err := json.Unmarshal([]byte(*raw), &events); err != nil {
		return nil, fmt.Errorf("storage: decode span events: %w", err)
	}
	return events, nil
}

// summarizeSpans computes a TraceSummary from a trace's full (deduped) span
// set. This is the single-trace counterpart of tracesPageQuery's SQL
// aggregation — used by TraceByID, where fetching one trace's spans in Go
// and reducing them directly is simpler than a second SQL aggregate path,
// and mirrors the old store package's ConvertTraces/isBetterRoot span-by-span walk
// almost exactly.
func summarizeSpans(traceID string, spans []SpanDetail) TraceSummary {
	t := TraceSummary{TraceID: traceID, SpanCount: len(spans)}
	if len(spans) == 0 {
		return t
	}

	t.StartTime = spans[0].StartTS
	endTime := spans[0].EndTS
	var root *SpanDetail
	for i := range spans {
		sp := &spans[i]
		if sp.StartTS.Before(t.StartTime) {
			t.StartTime = sp.StartTS
		}
		if sp.EndTS.After(endTime) {
			endTime = sp.EndTS
		}
		if sp.StatusCode == "Error" {
			t.HasError = true
		}
		if sp.ParentSpanID == "" && (root == nil || sp.Duration > root.Duration) {
			root = sp
		}
	}
	t.Duration = endTime.Sub(t.StartTime)

	if root != nil {
		t.HasRoot = true
		t.RootName = root.Name
		t.RootKind = root.Kind
		t.RootStatusCode = root.StatusCode
		t.RootDuration = root.Duration
		t.ServiceName = root.ServiceName
		return t
	}

	// Rootless: fall back to the earliest-started span's service, matching
	// the old store package's trace.go rootless rule (trace.go:210).
	earliest := &spans[0]
	for i := range spans {
		if spans[i].StartTS.Before(earliest.StartTS) {
			earliest = &spans[i]
		}
	}
	t.ServiceName = earliest.ServiceName
	return t
}

// PickRootSpan reproduces the old store package's isBetterRoot rule: the
// parentless span with the longest duration represents the trace. Shared by
// internal/broadcast (translating a commit into the WebSocket wire shape)
// and internal/graphql (resolving a TraceResolver's rootSpan field), which
// both need "the" root span of an already-fetched span set without
// re-deriving TraceSummary's Root* columns from scratch.
func PickRootSpan(spans []SpanDetail) *SpanDetail {
	var root *SpanDetail
	for i := range spans {
		sp := &spans[i]
		if sp.ParentSpanID != "" {
			continue
		}
		if root == nil || sp.Duration > root.Duration {
			root = sp
		}
	}
	return root
}

// TraceByIDCalls returns the number of TraceByID invocations so far — see
// the traceByIDCalls field doc on Storage.
func (s *Storage) TraceByIDCalls() int64 {
	return s.traceByIDCalls.Load()
}

// pageLimit returns limit, or a large sentinel when limit <= 0 ("no limit"),
// since DuckDB's LIMIT clause here is always parameterized rather than
// conditionally included in the SQL text.
func pageLimit(limit int) int64 {
	if limit <= 0 {
		return 1 << 62
	}
	return int64(limit)
}
