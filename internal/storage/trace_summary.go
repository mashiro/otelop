package storage

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"

	duckdb "github.com/duckdb/duckdb-go/v2"
	"go.opentelemetry.io/otel/attribute"
)

type traceSummaryState struct {
	TraceID   string
	StartTime time.Time
	EndTime   time.Time
	SpanCount int
	HasError  bool
	FirstSeen time.Time

	HasRoot          bool
	RootSpanID       string
	RootName         string
	RootKind         string
	RootStatusCode   string
	RootStartTime    time.Time
	RootEndTime      time.Time
	RootResourceHash uint64

	hasEarliest          bool
	EarliestSpanID       string
	EarliestResourceHash uint64
}

func (s *Storage) traceServiceName(ctx context.Context, state *traceSummaryState) (string, error) {
	resourceHash := state.EarliestResourceHash
	if state.HasRoot {
		resourceHash = state.RootResourceHash
	}
	var serviceName string
	if err := s.writer.QueryRowContext(ctx,
		`SELECT service_name FROM resources WHERE resource_hash = ?`,
		duckdb.Typed(resourceHash, duckdb.TYPE_UBIGINT),
	).Scan(&serviceName); err != nil {
		return "", fmt.Errorf("lookup trace service name: %w", err)
	}
	return serviceName, nil
}

func (state *traceSummaryState) mergeSpan(row SpanRow, ingestedAt time.Time) {
	if state.SpanCount == 0 {
		state.TraceID = row.TraceID
		state.StartTime = row.StartTS
		state.EndTime = row.EndTS
		state.FirstSeen = ingestedAt
	}
	if !state.hasEarliest || row.StartTS.Before(state.StartTime) ||
		(row.StartTS.Equal(state.StartTime) && row.SpanID < state.EarliestSpanID) {
		state.hasEarliest = true
		state.EarliestSpanID = row.SpanID
		state.EarliestResourceHash = row.ResourceHash
	}
	if row.StartTS.Before(state.StartTime) {
		state.StartTime = row.StartTS
	}
	if row.EndTS.After(state.EndTime) {
		state.EndTime = row.EndTS
	}
	if ingestedAt.Before(state.FirstSeen) {
		state.FirstSeen = ingestedAt
	}
	state.SpanCount++
	state.HasError = state.HasError || row.StatusCode == "Error"

	if row.ParentSpanID == "" && state.preferRoot(row) {
		state.HasRoot = true
		state.RootSpanID = row.SpanID
		state.RootName = row.Name
		state.RootKind = row.Kind
		state.RootStatusCode = row.StatusCode
		state.RootStartTime = row.StartTS
		state.RootEndTime = row.EndTS
		state.RootResourceHash = row.ResourceHash
	}
}

func (state *traceSummaryState) preferRoot(row SpanRow) bool {
	if !state.HasRoot {
		return true
	}
	duration := row.EndTS.Sub(row.StartTS)
	currentDuration := state.RootEndTime.Sub(state.RootStartTime)
	return duration > currentDuration || (duration == currentDuration && row.SpanID < state.RootSpanID)
}

func (s *Storage) traceSummaryStatesByIDs(ctx context.Context, q queryContexter, traceIDs []string) (map[string]*traceSummaryState, error) {
	result := make(map[string]*traceSummaryState, len(traceIDs))
	if len(traceIDs) == 0 {
		return result, nil
	}
	marks := strings.TrimSuffix(strings.Repeat("?,", len(traceIDs)), ",")
	args := make([]any, len(traceIDs))
	for i, traceID := range traceIDs {
		args[i] = traceID
	}
	rows, err := q.QueryContext(ctx, `
		SELECT
			trace_id, start_ts, end_ts, span_count, has_error, first_seen,
			root_span_id, root_name, root_kind, root_status_code, root_start_ts,
			root_end_ts, COALESCE(root_resource_hash, 0),
			earliest_span_id, earliest_resource_hash
		FROM trace_summaries
		WHERE trace_id IN (`+marks+`)
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("storage: query trace summary states: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		state := &traceSummaryState{hasEarliest: true}
		var rootSpanID, rootName, rootKind, rootStatus sql.NullString
		var rootStart, rootEnd sql.NullTime
		if err := rows.Scan(
			&state.TraceID, &state.StartTime, &state.EndTime, &state.SpanCount,
			&state.HasError, &state.FirstSeen, &rootSpanID, &rootName, &rootKind,
			&rootStatus, &rootStart, &rootEnd, &state.RootResourceHash,
			&state.EarliestSpanID, &state.EarliestResourceHash,
		); err != nil {
			return nil, fmt.Errorf("storage: scan trace summary state: %w", err)
		}
		if rootSpanID.Valid {
			state.HasRoot = true
			state.RootSpanID = rootSpanID.String
			state.RootName = rootName.String
			state.RootKind = rootKind.String
			state.RootStatusCode = rootStatus.String
			state.RootStartTime = rootStart.Time
			state.RootEndTime = rootEnd.Time
		}
		result[state.TraceID] = state
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("storage: iterate trace summary states: %w", err)
	}
	return result, nil
}

func mergeTraceSummaryStates(existing map[string]*traceSummaryState, rows []SpanRow, ingestedAt time.Time) map[string]*traceSummaryState {
	for _, row := range rows {
		state := existing[row.TraceID]
		if state == nil {
			state = &traceSummaryState{}
			existing[row.TraceID] = state
		}
		state.mergeSpan(row, ingestedAt)
	}
	return existing
}

func (s *Storage) upsertTraceSummaryStates(ctx context.Context, states map[string]*traceSummaryState) error {
	if len(states) == 0 {
		return nil
	}
	traceIDs := make([]string, 0, len(states))
	for traceID := range states {
		traceIDs = append(traceIDs, traceID)
	}
	sort.Strings(traceIDs)
	values := make([]string, len(traceIDs))
	args := make([]any, 0, len(traceIDs)*15)
	for i, traceID := range traceIDs {
		state := states[traceID]
		values[i] = `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS UBIGINT), ?, CAST(? AS UBIGINT))`
		var rootSpanID, rootName, rootKind, rootStatus any
		var rootStart, rootEnd any
		var rootResourceHash any
		if state.HasRoot {
			rootSpanID = state.RootSpanID
			rootName = state.RootName
			rootKind = state.RootKind
			rootStatus = state.RootStatusCode
			rootStart = duckdb.Typed(state.RootStartTime, duckdb.TYPE_TIMESTAMP_NS)
			rootEnd = duckdb.Typed(state.RootEndTime, duckdb.TYPE_TIMESTAMP_NS)
			rootResourceHash = strconv.FormatUint(state.RootResourceHash, 10)
		}
		args = append(args,
			state.TraceID,
			duckdb.Typed(state.StartTime, duckdb.TYPE_TIMESTAMP_NS),
			duckdb.Typed(state.EndTime, duckdb.TYPE_TIMESTAMP_NS),
			state.SpanCount,
			state.HasError,
			duckdb.Typed(state.FirstSeen, duckdb.TYPE_TIMESTAMP_NS),
			rootSpanID, rootName, rootKind, rootStatus, rootStart, rootEnd, rootResourceHash,
			state.EarliestSpanID, strconv.FormatUint(state.EarliestResourceHash, 10),
		)
	}
	_, err := s.writer.ExecContext(ctx, `
		INSERT INTO trace_summaries VALUES `+strings.Join(values, ",")+`
		ON CONFLICT (trace_id) DO UPDATE SET
			start_ts = excluded.start_ts,
			end_ts = excluded.end_ts,
			span_count = excluded.span_count,
			has_error = excluded.has_error,
			first_seen = excluded.first_seen,
			root_span_id = excluded.root_span_id,
			root_name = excluded.root_name,
			root_kind = excluded.root_kind,
			root_status_code = excluded.root_status_code,
			root_start_ts = excluded.root_start_ts,
			root_end_ts = excluded.root_end_ts,
			root_resource_hash = excluded.root_resource_hash,
			earliest_span_id = excluded.earliest_span_id,
			earliest_resource_hash = excluded.earliest_resource_hash
	`, args...)
	if err != nil {
		return fmt.Errorf("storage: upsert trace summaries: %w", err)
	}
	return nil
}

type spanKey struct {
	traceID string
	spanID  string
}

func (s *Storage) filterNewSpans(ctx context.Context, rows []SpanRow, existingStates map[string]*traceSummaryState) (inserted []SpanRow, err error) {
	ctx, span := startStorageSpan(ctx, "storage.deduplicateSpans", attribute.Int("storage.batch.rows", len(rows)))
	defer func() { endStorageSpan(span, err) }()

	candidatesByTrace := make(map[string]map[string]struct{})
	traceIDs := distinctTraceIDsForRows(rows)
	for _, row := range rows {
		if _, exists := existingStates[row.TraceID]; !exists {
			continue
		}
		spanIDs := candidatesByTrace[row.TraceID]
		if spanIDs == nil {
			spanIDs = make(map[string]struct{})
			candidatesByTrace[row.TraceID] = spanIDs
		}
		spanIDs[row.SpanID] = struct{}{}
	}

	lookupTraceIDs := make([]string, 0, len(candidatesByTrace))
	for _, traceID := range traceIDs {
		if len(candidatesByTrace[traceID]) > 0 {
			lookupTraceIDs = append(lookupTraceIDs, traceID)
		}
	}
	existingKeys := make(map[spanKey]struct{})
	const traceLookupBatchSize = 32
	lookupBatches := 0
	for start := 0; start < len(lookupTraceIDs); start += traceLookupBatchSize {
		end := min(start+traceLookupBatchSize, len(lookupTraceIDs))
		parts := make([]string, 0, end-start)
		args := make([]any, 0)
		for _, traceID := range lookupTraceIDs[start:end] {
			candidateIDs := candidatesByTrace[traceID]
			marks := strings.TrimSuffix(strings.Repeat("?,", len(candidateIDs)), ",")
			parts = append(parts, `SELECT trace_id, span_id FROM spans WHERE trace_id = ? AND span_id IN (`+marks+`)`)
			args = append(args, traceID)
			for spanID := range candidateIDs {
				args = append(args, spanID)
			}
		}
		lookupBatches++
		existingRows, queryErr := s.writer.QueryContext(ctx, strings.Join(parts, " UNION ALL "), args...)
		if queryErr != nil {
			return nil, fmt.Errorf("storage: query existing candidate spans: %w", queryErr)
		}
		for existingRows.Next() {
			var traceID, spanID string
			if scanErr := existingRows.Scan(&traceID, &spanID); scanErr != nil {
				_ = existingRows.Close()
				return nil, fmt.Errorf("storage: scan existing candidate span: %w", scanErr)
			}
			existingKeys[spanKey{traceID: traceID, spanID: spanID}] = struct{}{}
		}
		if rowsErr := existingRows.Err(); rowsErr != nil {
			_ = existingRows.Close()
			return nil, fmt.Errorf("storage: iterate existing candidate spans: %w", rowsErr)
		}
		if closeErr := existingRows.Close(); closeErr != nil {
			return nil, fmt.Errorf("storage: close existing candidate spans: %w", closeErr)
		}
	}

	seen := make(map[spanKey]struct{}, len(rows))
	inserted = make([]SpanRow, 0, len(rows))
	for _, row := range rows {
		key := spanKey{traceID: row.TraceID, spanID: row.SpanID}
		if _, exists := existingKeys[key]; exists {
			continue
		}
		if _, duplicateInBatch := seen[key]; duplicateInBatch {
			continue
		}
		seen[key] = struct{}{}
		inserted = append(inserted, row)
	}
	span.SetAttributes(
		attribute.Int("storage.dedup.trace_lookups", len(lookupTraceIDs)),
		attribute.Int("storage.dedup.lookup_batches", lookupBatches),
		attribute.Int("storage.dedup.existing_rows", len(existingKeys)),
		attribute.Int("storage.rows.kept", len(inserted)),
	)
	return inserted, nil
}

func (s *Storage) appendSpans(ctx context.Context, spans []SpanRow, ingestedAt time.Time) (err error) {
	_, span := startStorageSpan(ctx, "storage.appendSpans", attribute.Int("db.rows", len(spans)))
	defer func() { endStorageSpan(span, err) }()
	err = s.writer.Raw(func(driverConn any) error {
		appender, err := duckdb.NewAppenderFromConn(driverConn.(driver.Conn), "", "spans")
		if err != nil {
			return err
		}
		defer func() { _ = appender.Close() }()
		for _, sp := range spans {
			if err := appender.AppendRow(
				sp.TraceID, sp.SpanID, sp.ParentSpanID, sp.Name, sp.Kind,
				sp.StartTS, sp.EndTS, sp.StatusCode, sp.StatusMessage,
				sp.Attributes, spanEventsArg(sp.Events), sp.ResourceHash, ingestedAt,
			); err != nil {
				return err
			}
		}
		if err := appender.Flush(); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("storage: append spans: %w", err)
	}
	return nil
}

const traceSummariesFromTableQuery = `
SELECT
	t.trace_id, t.start_ts, t.end_ts, t.span_count, t.has_error,
	COALESCE(root_res.service_name, earliest_res.service_name) AS service_name,
	t.root_name, t.root_kind, t.root_status_code, t.root_start_ts, t.root_end_ts
FROM trace_summaries t
LEFT JOIN resources root_res ON root_res.resource_hash = t.root_resource_hash
LEFT JOIN resources earliest_res ON earliest_res.resource_hash = t.earliest_resource_hash
WHERE t.trace_id IN (%s)
`

const rebuildTraceSummariesQuery = `
WITH deduped AS (
	SELECT s.*
	FROM spans s
	JOIN affected_traces a USING (trace_id)
	QUALIFY row_number() OVER (PARTITION BY s.trace_id, s.span_id ORDER BY s.ingested_at) = 1
),
agg AS (
	SELECT
		trace_id, min(start_ts) AS start_ts, max(end_ts) AS end_ts,
		count(*) AS span_count, bool_or(status_code = 'Error') AS has_error,
		min(ingested_at) AS first_seen
	FROM deduped
	GROUP BY trace_id
),
root_candidates AS (
	SELECT
		trace_id, span_id, name, kind, status_code, start_ts, end_ts, resource_hash,
		row_number() OVER (
			PARTITION BY trace_id ORDER BY (end_ts - start_ts) DESC, span_id
		) AS rn
	FROM deduped
	WHERE parent_span_id = ''
),
roots AS (
	SELECT
		trace_id, span_id AS root_span_id, name AS root_name, kind AS root_kind,
		status_code AS root_status_code, start_ts AS root_start_ts,
		end_ts AS root_end_ts, resource_hash AS root_resource_hash
	FROM root_candidates
	WHERE rn = 1
),
earliest_candidates AS (
	SELECT
		trace_id, span_id, resource_hash,
		row_number() OVER (PARTITION BY trace_id ORDER BY start_ts, span_id) AS rn
	FROM deduped
),
earliest AS (
	SELECT
		trace_id, span_id AS earliest_span_id,
		resource_hash AS earliest_resource_hash
	FROM earliest_candidates
	WHERE rn = 1
)
INSERT INTO trace_summaries
SELECT
	a.trace_id, a.start_ts, a.end_ts, a.span_count, a.has_error, a.first_seen,
	r.root_span_id, r.root_name, r.root_kind, r.root_status_code,
	r.root_start_ts, r.root_end_ts, r.root_resource_hash,
	e.earliest_span_id, e.earliest_resource_hash
FROM agg a
LEFT JOIN roots r USING (trace_id)
JOIN earliest e USING (trace_id)
`

func (s *Storage) rebuildAffectedTraceSummaries(ctx context.Context) error {
	if _, err := s.writer.ExecContext(ctx, `
		DELETE FROM trace_summaries
		WHERE trace_id IN (SELECT trace_id FROM affected_traces)
	`); err != nil {
		return fmt.Errorf("storage: clear affected trace summaries: %w", err)
	}
	if _, err := s.writer.ExecContext(ctx, rebuildTraceSummariesQuery); err != nil {
		return fmt.Errorf("storage: rebuild affected trace summaries: %w", err)
	}
	return nil
}

// rebuildAllTraceSummaries is the one-time backfill and repair path for the
// derived table. Ingestion never calls it; spans remain the source of truth.
func (s *Storage) rebuildAllTraceSummaries(ctx context.Context) error {
	if _, err := s.writer.ExecContext(ctx, `BEGIN TRANSACTION`); err != nil {
		return fmt.Errorf("storage: begin trace summary rebuild: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = s.writer.ExecContext(context.Background(), `ROLLBACK`)
		}
	}()
	if _, err := s.writer.ExecContext(ctx, `
		CREATE OR REPLACE TEMP TABLE affected_traces AS
		SELECT DISTINCT trace_id FROM spans
	`); err != nil {
		return fmt.Errorf("storage: collect traces for summary rebuild: %w", err)
	}
	if _, err := s.writer.ExecContext(ctx, `DELETE FROM trace_summaries`); err != nil {
		return fmt.Errorf("storage: clear trace summaries for rebuild: %w", err)
	}
	if err := s.rebuildAffectedTraceSummaries(ctx); err != nil {
		return err
	}
	if _, err := s.writer.ExecContext(ctx, `COMMIT`); err != nil {
		return fmt.Errorf("storage: commit trace summary rebuild: %w", err)
	}
	committed = true
	return nil
}

func (s *Storage) traceSummariesFromTable(ctx context.Context, q queryContexter, traceIDs []string) ([]TraceSummary, error) {
	if len(traceIDs) == 0 {
		return []TraceSummary{}, nil
	}
	marks := strings.TrimSuffix(strings.Repeat("?,", len(traceIDs)), ",")
	args := make([]any, len(traceIDs))
	for i, traceID := range traceIDs {
		args[i] = traceID
	}
	rows, err := q.QueryContext(ctx, fmt.Sprintf(traceSummariesFromTableQuery, marks), args...)
	if err != nil {
		return nil, fmt.Errorf("storage: query stored trace summaries: %w", err)
	}
	return scanTraceSummaries(rows, len(traceIDs))
}

func (s *Storage) writeTraceRowsTransaction(ctx context.Context, rows []SpanRow, ingestedAt time.Time) (retained []SpanRow, summaries []TraceSummary, droppedTraceIDs []string, err error) {
	if _, err := s.writer.ExecContext(ctx, `BEGIN TRANSACTION`); err != nil {
		return nil, nil, nil, fmt.Errorf("storage: begin trace write: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = s.writer.ExecContext(context.Background(), `ROLLBACK`)
		}
	}()

	affectedTraceIDs := distinctTraceIDsForRows(rows)
	existingStates, err := s.traceSummaryStatesByIDs(ctx, s.writer, affectedTraceIDs)
	if err != nil {
		return nil, nil, nil, err
	}
	inserted, err := s.filterNewSpans(ctx, rows, existingStates)
	if err != nil {
		return nil, nil, nil, err
	}
	if len(inserted) == 0 {
		if _, err := s.writer.ExecContext(ctx, `COMMIT`); err != nil {
			return nil, nil, nil, fmt.Errorf("storage: commit duplicate trace batch: %w", err)
		}
		committed = true
		return []SpanRow{}, []TraceSummary{}, nil, nil
	}
	if err := s.appendSpans(ctx, inserted, ingestedAt); err != nil {
		return nil, nil, nil, err
	}

	traceIDs := distinctTraceIDsForRows(inserted)
	states := make(map[string]*traceSummaryState, len(traceIDs))
	for _, traceID := range traceIDs {
		if state := existingStates[traceID]; state != nil {
			states[traceID] = state
		}
	}
	states = mergeTraceSummaryStates(states, inserted, ingestedAt)
	dropped := make(map[string]struct{})
	for traceID, state := range states {
		if state.SpanCount <= maxSpansPerTrace {
			continue
		}
		serviceName, metadataErr := s.traceServiceName(ctx, state)
		if _, err := s.writer.ExecContext(ctx, `DELETE FROM spans WHERE trace_id = ?`, traceID); err != nil {
			return nil, nil, nil, fmt.Errorf("storage: delete oversized trace: %w", err)
		}
		if _, err := s.writer.ExecContext(ctx, `DELETE FROM trace_summaries WHERE trace_id = ?`, traceID); err != nil {
			return nil, nil, nil, fmt.Errorf("storage: delete oversized trace summary: %w", err)
		}
		if _, err := s.writer.ExecContext(ctx, `
			INSERT INTO dropped_traces VALUES (?, ?, ?)
			ON CONFLICT (trace_id) DO UPDATE SET last_seen = excluded.last_seen, span_count = excluded.span_count
		`, traceID, ingestedAt, state.SpanCount); err != nil {
			return nil, nil, nil, fmt.Errorf("storage: tombstone oversized trace: %w", err)
		}
		dropped[traceID] = struct{}{}
		droppedTraceIDs = append(droppedTraceIDs, traceID)
		delete(states, traceID)
		logAttrs := []any{
			"trace_id", traceID,
			"span_count", state.SpanCount,
			"limit", maxSpansPerTrace,
			"trace_service_name", serviceName,
			"trace_start_time", state.StartTime.UTC().Format(time.RFC3339Nano),
			"trace_end_time", state.EndTime.UTC().Format(time.RFC3339Nano),
			"trace_duration_ms", float64(state.EndTime.Sub(state.StartTime).Microseconds()) / 1000,
			"trace_has_root", state.HasRoot,
		}
		if state.HasRoot {
			logAttrs = append(logAttrs, "trace_root_span_name", state.RootName)
		}
		if metadataErr != nil {
			logAttrs = append(logAttrs, "trace_metadata_error", metadataErr)
		}
		slog.Warn("storage: dropped oversized trace", logAttrs...)
	}
	if err := s.upsertTraceSummaryStates(ctx, states); err != nil {
		return nil, nil, nil, err
	}

	retained = make([]SpanRow, 0, len(inserted))
	for _, row := range inserted {
		if _, wasDropped := dropped[row.TraceID]; !wasDropped {
			retained = append(retained, row)
		}
	}
	retainedTraceIDs := distinctTraceIDsForRows(retained)
	summaries, err = s.traceSummariesFromTable(ctx, s.writer, retainedTraceIDs)
	if err != nil {
		return nil, nil, nil, err
	}
	if _, err := s.writer.ExecContext(ctx, `COMMIT`); err != nil {
		return nil, nil, nil, fmt.Errorf("storage: commit trace write: %w", err)
	}
	committed = true
	sort.Strings(droppedTraceIDs)
	return retained, summaries, droppedTraceIDs, nil
}
