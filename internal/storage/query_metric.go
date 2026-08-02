package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	duckdb "github.com/duckdb/duckdb-go/v2"
	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"
)

// MetricSummary is one (service_name, metric_name) group — the same
// granularity the old store package's MetricData used (grouped across every
// attribute-series, not one row per series), reproduced here by grouping
// metric_series rows. SeriesKeys lets a caller inspect which series make up
// the group without a second lookup; MetricPoints is the normal way to fetch
// its data points.
type MetricSummary struct {
	ServiceName string
	MetricName  string
	Type        string
	Unit        string
	Description string
	LastSeen    time.Time
	SeriesKeys  []uint64
	// Resource is the resource attribute map of the group's most-recently-seen
	// series (arg_max by last_seen over the resources join) — the group-level
	// display value, roughly matching the old store package's "one MetricData carries
	// one resource" behavior even though each series stores its own hash.
	Resource map[string]any
	// PointCount and LatestValue are populated in batches for a metrics page,
	// avoiding one full-history query plus one latest-point query per item.
	PointCount  int
	LatestValue *float64
}

type MetricCursor struct {
	LastSeen    time.Time
	ServiceName string
	MetricName  string
}

// DerivedPoint is one metric observation with delta/cumulative values
// derived at query time (see docs/design/duckdb-storage.md's "Reads"
// section). Value and Cumulative are populated for Gauge/Sum; Count/
// CountCumulative/Sum/SumCumulative/Min/Max for Histogram/
// ExponentialHistogram/Summary — mirroring the old store package's DataPoint shape,
// except every field that could be a baseline observation is a pointer so
// SQL NULL round-trips instead of being silently coerced to zero.
type DerivedPoint struct {
	ID uuid.UUID
	TS time.Time
	// Type is this point's series' metric_type (e.g. "Sum", "Histogram"),
	// carried per-row rather than only at the MetricSummary/group level so a
	// caller filtering baseline observations (see FilterDerivedPoints) can
	// decide which of Value/Count is the meaningful field without a
	// separate group-metadata lookup — the top-level metricPoints query
	// (issue #162) has no MetricSummary in hand the way MetricResolver does.
	Type            string
	Value           *float64
	Cumulative      *float64
	Count           *float64
	CountCumulative *float64
	Sum             *float64
	SumCumulative   *float64
	Min             *float64
	Max             *float64
	Attributes      map[string]any
}

// distributionTypesSQL is metricTypesAreDistribution's SQL-side twin: the
// literal IN-list every derived-point query below gates distribution output
// columns (out_count/out_sum/...) on. Keeping the Go rule and the SQL
// fragment next to each other, both spelling out the exact same three
// OTLP metric type names, is what keeps them from drifting apart.
const distributionTypesSQL = `('Histogram', 'ExponentialHistogram', 'Summary')`

// predecessorRequiredSQL identifies source series whose first selected point
// needs an older observation for lag-based delta derivation. Delta sources,
// Gauges, and non-monotonic Sums derive entirely from the selected window.
const predecessorRequiredSQL = `(temporality = 'cumulative' AND (` +
	`(metric_type = 'Sum' AND is_monotonic) OR metric_type IN ` + distributionTypesSQL + `))`

// IsDistributionType reports whether metricType names one of the
// distribution shapes (Histogram/ExponentialHistogram/Summary), which carry
// Count/Sum instead of a plain Value — see DataPoint's schema doc comment
// and distributionTypesSQL, its SQL-side twin.
func IsDistributionType(metricType string) bool {
	return metricType == "Histogram" || metricType == "ExponentialHistogram" || metricType == "Summary"
}

// FilterDerivedPoints drops baseline observations — a point with nothing to
// derive a delta against yet, invisible to any caller (internal/broadcast's
// WebSocket path and internal/graphql's GraphQL surface both apply this
// exact rule) — using each row's own Type rather than a separately-fetched
// MetricSummary, so every caller filters through one implementation.
func FilterDerivedPoints(points []DerivedPoint) []DerivedPoint {
	filtered := make([]DerivedPoint, 0, len(points))
	for _, p := range points {
		if p.Value == nil {
			continue
		}
		if IsDistributionType(p.Type) && p.Count == nil {
			continue
		}
		filtered = append(filtered, p)
	}
	return filtered
}

// metricsPageQuery groups metric_series by (service_name, metric_name) —
// deliberately not by series_key, since a single MetricSummary must
// represent every attribute-series belonging to a metric, matching
// the old store package's convertMetrics grouping (see metricKey). Series filtering
// is the standard interval-overlap test between the series' [first_seen,
// last_seen] lifetime and the query range [from, to): first_seen < to AND
// last_seen >= from. Filtering on last_seen alone would exclude a series
// that is still being observed now (last_seen ≈ now) from every past
// window — exactly the history-browsing case this query layer exists for.
//
// Parameter order: to binds first (first_seen < to), from second
// (last_seen >= from) — the reverse of the other list queries.
const metricsPageQuery = `
WITH filtered AS (
	SELECT s.*, r.attributes::VARCHAR AS resource_json
	FROM metric_series s
	JOIN resources r ON r.resource_hash = s.resource_hash
	WHERE s.first_seen < ? AND s.last_seen >= ?
	AND (
		s.metric_name ILIKE ? ESCAPE '\' OR
		s.service_name ILIKE ? ESCAPE '\' OR
		s.metric_type ILIKE ? ESCAPE '\' OR
		s.description ILIKE ? ESCAPE '\'
	)
)
SELECT
	service_name,
	metric_name,
	arg_max(metric_type, last_seen)   AS metric_type,
	arg_max(unit, last_seen)          AS unit,
	arg_max(description, last_seen)   AS description,
	max(last_seen)                    AS last_seen,
	list(series_key)                  AS series_keys,
	arg_max(resource_json, last_seen) AS resource_json
FROM filtered
GROUP BY service_name, metric_name
HAVING (CAST(? AS BOOLEAN) OR max(last_seen) < ?
	OR (max(last_seen) = ? AND service_name < ?)
	OR (max(last_seen) = ? AND service_name = ? AND metric_name < ?))
ORDER BY last_seen DESC, service_name DESC, metric_name DESC
LIMIT ?
`

// MetricsPage returns a page of metric groups (one per distinct
// service+metric name pair, most-recently-active first), fetching one extra
// group to report whether another page exists without an exact count.
func (s *Storage) MetricsPage(ctx context.Context, from, to time.Time, after *MetricCursor, limit int) ([]MetricSummary, bool, error) {
	return s.MetricsPageSearch(ctx, from, to, after, limit, "")
}

// MetricsPageSearch is MetricsPage with a case-insensitive substring search
// over the fields rendered by the metrics list.
func (s *Storage) MetricsPageSearch(ctx context.Context, from, to time.Time, after *MetricCursor, limit int, search string) (items []MetricSummary, hasNextPage bool, err error) {
	ctx, span := startStorageSpan(ctx, "storage.MetricsPage", attribute.Int("db.limit", limit))
	defer func() { endStorageSpan(span, err) }()
	started := time.Now()
	defer func() { s.recordQuery(ctx, "query_metrics", started, err) }()
	pattern := likePattern(search)
	queryLimit := pageLimit(limit)
	if limit > 0 {
		queryLimit++
	}
	firstPage, cursorSeen, cursorService, cursorName := metricCursorArgs(after)
	rows, err := s.DB().QueryContext(ctx, metricsPageQuery, to, from, pattern, pattern, pattern, pattern,
		firstPage, cursorSeen, cursorSeen, cursorService, cursorSeen, cursorService, cursorName, queryLimit)
	if err != nil {
		return nil, false, fmt.Errorf("storage: query metrics page: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items = make([]MetricSummary, 0)
	for rows.Next() {
		var (
			m           MetricSummary
			seriesKeys  any
			resourceRaw *string
		)
		if err := rows.Scan(&m.ServiceName, &m.MetricName, &m.Type, &m.Unit, &m.Description, &m.LastSeen, &seriesKeys, &resourceRaw); err != nil {
			return nil, false, fmt.Errorf("storage: scan metric summary: %w", err)
		}
		m.SeriesKeys = decodeSeriesKeys(seriesKeys)
		resource, err := decodeAttrs(resourceRaw)
		if err != nil {
			return nil, false, err
		}
		m.Resource = resource
		items = append(items, m)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("storage: iterate metrics page: %w", err)
	}
	if limit > 0 && len(items) > limit {
		hasNextPage = true
		items = items[:limit]
	}
	if err := s.populateMetricSummaryStats(ctx, items, from, to); err != nil {
		return nil, false, err
	}
	return items, hasNextPage, nil
}

func metricCursorArgs(after *MetricCursor) (bool, time.Time, string, string) {
	if after == nil {
		return true, time.Unix(0, 0).UTC(), "", ""
	}
	return false, after.LastSeen, after.ServiceName, after.MetricName
}

// populateMetricSummaryStats resolves the two metrics-list glance fields in
// two page-wide queries. This keeps Query.metrics at a constant number of SQL
// round trips instead of resolving pointCount and latestValue once per item.
func (s *Storage) populateMetricSummaryStats(ctx context.Context, items []MetricSummary, from, to time.Time) (err error) {
	ctx, span := startStorageSpan(ctx, "storage.populateMetricSummaryStats", attribute.Int("db.rows", len(items)))
	defer func() { endStorageSpan(span, err) }()
	started := time.Now()
	defer func() { s.recordQuery(ctx, "query_metric_summary_stats", started, err) }()
	if len(items) == 0 {
		return nil
	}
	values := make([]string, len(items))
	args := make([]any, 0, len(items)*2+3)
	for i := range items {
		values[i] = "(?, ?)"
		args = append(args, items[i].ServiceName, items[i].MetricName)
	}
	selected := strings.Join(values, ", ")

	countQuery := `
WITH selected(service_name, metric_name) AS (VALUES ` + selected + `),
target_series AS (
	SELECT s.service_name, s.metric_name, s.series_key, s.metric_type,
		s.temporality, s.is_monotonic
	FROM selected x
	JOIN metric_series s USING (service_name, metric_name)
), window_points AS (
	SELECT s.service_name, s.metric_name, s.series_key, s.metric_type,
		s.temporality, s.is_monotonic, p.ts,
		coalesce(p.value_double, cast(p.value_int AS DOUBLE)) AS value,
		cast(p.count AS DOUBLE) AS count
	FROM target_series s
	JOIN metric_points p USING (series_key)
	WHERE p.ts >= make_timestamp_ns(?) AND p.ts < make_timestamp_ns(?)
), represented_series AS (
	SELECT DISTINCT series_key FROM window_points
	WHERE ` + predecessorRequiredSQL + `
), predecessor_series AS (
	SELECT DISTINCT p.series_key
	FROM metric_points p
	JOIN represented_series r USING (series_key)
	WHERE p.ts < make_timestamp_ns(?)
), points AS (
	SELECT window_points.*,
		predecessor_series.series_key IS NOT NULL AS has_predecessor
	FROM window_points
	LEFT JOIN predecessor_series USING (series_key)
), ranked AS (
	SELECT *, row_number() OVER (PARTITION BY series_key ORDER BY ts) AS point_rank
	FROM points
)
SELECT service_name, metric_name, sum(
	CASE
		WHEN metric_type IN ` + distributionTypesSQL + `
			AND count IS NOT NULL
			AND (temporality <> 'cumulative' OR point_rank > 1 OR has_predecessor) THEN 1
		WHEN metric_type NOT IN ` + distributionTypesSQL + ` AND value IS NOT NULL
			AND (metric_type <> 'Sum' OR temporality <> 'cumulative' OR NOT is_monotonic
				OR point_rank > 1 OR has_predecessor) THEN 1
		ELSE 0
	END
)
FROM ranked
GROUP BY service_name, metric_name`
	countArgs := append(args, from.UnixNano(), to.UnixNano(), from.UnixNano())
	rows, err := s.DB().QueryContext(ctx, countQuery, countArgs...)
	if err != nil {
		return fmt.Errorf("storage: query metric summary point counts: %w", err)
	}
	counts := make(map[string]int, len(items))
	for rows.Next() {
		var serviceName, metricName string
		var count int
		if err := rows.Scan(&serviceName, &metricName, &count); err != nil {
			_ = rows.Close()
			return fmt.Errorf("storage: scan metric summary point count: %w", err)
		}
		counts[serviceName+"\x00"+metricName] = count
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("storage: close metric summary point counts: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("storage: iterate metric summary point counts: %w", err)
	}

	latestQuery := `
WITH selected(service_name, metric_name) AS (VALUES ` + selected + `),
targets AS (
	SELECT s.service_name, s.metric_name, arg_max(s.series_key, s.last_seen) AS series_key
	FROM selected x JOIN metric_series s USING (service_name, metric_name)
	GROUP BY s.service_name, s.metric_name
), ranked AS (
	SELECT t.service_name, t.metric_name, p.series_key, p.ts,
		coalesce(p.value_double, cast(p.value_int AS DOUBLE)) AS value,
		cast(p.count AS DOUBLE) AS count, p.sum,
		s.metric_type, s.temporality, s.is_monotonic,
		row_number() OVER (PARTITION BY p.series_key ORDER BY p.ts DESC, p.id DESC) AS point_rank
	FROM targets t JOIN metric_points p USING (series_key) JOIN metric_series s USING (series_key)
), points AS (SELECT * FROM ranked WHERE point_rank <= 2),
derived AS (
	SELECT *,
		CASE WHEN metric_type = 'Sum' AND temporality = 'cumulative' AND is_monotonic
			THEN CASE WHEN lag(value) OVER w IS NULL THEN NULL
				WHEN value < lag(value) OVER w THEN value ELSE value - lag(value) OVER w END
			ELSE value END AS scalar_value,
		CASE WHEN temporality = 'cumulative'
			THEN CASE WHEN lag(count) OVER w IS NULL THEN NULL
				WHEN count < lag(count) OVER w THEN count ELSE count - lag(count) OVER w END
			ELSE count END AS count_delta,
		CASE WHEN temporality = 'cumulative'
			THEN CASE WHEN lag(sum) OVER w IS NULL THEN NULL
				WHEN sum < lag(sum) OVER w THEN sum ELSE sum - lag(sum) OVER w END
			ELSE sum END AS sum_delta
	FROM points WINDOW w AS (PARTITION BY series_key ORDER BY ts)
)
SELECT service_name, metric_name,
	CASE WHEN metric_type IN ` + distributionTypesSQL + `
		THEN CASE WHEN sum_delta IS NULL OR count_delta IS NULL OR count_delta <= 0 THEN NULL ELSE sum_delta / count_delta END
		ELSE scalar_value END AS latest_value
FROM derived QUALIFY row_number() OVER (PARTITION BY service_name, metric_name ORDER BY ts DESC) = 1`
	rows, err = s.DB().QueryContext(ctx, latestQuery, args...)
	if err != nil {
		return fmt.Errorf("storage: query metric summary latest values: %w", err)
	}
	latest := make(map[string]*float64, len(items))
	for rows.Next() {
		var serviceName, metricName string
		var value sql.NullFloat64
		if err := rows.Scan(&serviceName, &metricName, &value); err != nil {
			_ = rows.Close()
			return fmt.Errorf("storage: scan metric summary latest value: %w", err)
		}
		latest[serviceName+"\x00"+metricName] = nullFloatPtr(value)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("storage: close metric summary latest values: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("storage: iterate metric summary latest values: %w", err)
	}

	for i := range items {
		key := items[i].ServiceName + "\x00" + items[i].MetricName
		items[i].PointCount = counts[key]
		items[i].LatestValue = latest[key]
	}
	return nil
}

// decodeSeriesKeys converts the driver's generic representation of
// `list(series_key)` (a []any of boxed UBIGINT elements) into []uint64.
func decodeSeriesKeys(raw any) []uint64 {
	elems, ok := raw.([]any)
	if !ok {
		return nil
	}
	keys := make([]uint64, 0, len(elems))
	for _, e := range elems {
		switch v := e.(type) {
		case uint64:
			keys = append(keys, v)
		case int64:
			keys = append(keys, uint64(v))
		}
	}
	return keys
}

// metricDerivedFormula is the shared per-series delta/cumulative derivation
// (docs/design/duckdb-storage.md's "Reads" section): a `derived` CTE applying
// window functions partitioned by series_key so counter resets/cumulative
// baselines are resolved per-attribute-series before any caller merges or
// sums across series. It expects a preceding `points` CTE already in scope
// with columns request_index, id, series_key, ts, value, count, sum, min,
// max, metric_type, temporality, is_monotonic, attrs_json — request_index is
// zero for single-group callers and separates windows for the batch caller.
// metricDerivedCTE below supplies the
// group/window-wide `points` selection MetricPoints and MetricAggregate
// share; metricLatestValueQuery supplies a narrower one (a single series'
// last two rows) so the exact same CASE logic can derive "the latest value"
// without re-deriving a group's entire retained history.
//
// Scalar (Gauge/Sum) and distribution (Histogram/ExponentialHistogram/
// Summary) points are never mixed within one series (see convert.go), so
// metric_type gates which output columns apply to a given row: Value/
// Cumulative for scalars, Count/CountCumulative/Sum/SumCumulative for
// distributions.
//
// Delta derivation (both value and count/sum) special-cases a counter reset
// (current < previous) by emitting the raw current value rather than
// dropping the row — see the DerivedPoint doc comment on why this differs
// from the old store package's seriesStore, which drops both the baseline and any
// reset observation entirely.
const metricDerivedFormula = `
derived AS (
	SELECT
		request_index, id, series_key, ts, attrs_json, metric_type,
		CASE
			WHEN metric_type = 'Sum' AND temporality = 'cumulative' AND is_monotonic THEN
				CASE WHEN lag(value) OVER w IS NULL THEN NULL
				     WHEN value < lag(value) OVER w THEN value
				     ELSE value - lag(value) OVER w END
			ELSE value
		END AS scalar_value,
		CASE
			WHEN metric_type = 'Sum' AND temporality = 'cumulative' AND is_monotonic THEN value
			WHEN metric_type = 'Sum' AND temporality = 'delta' AND is_monotonic THEN sum(value) OVER w
			ELSE NULL
		END AS scalar_cumulative,
		CASE
			WHEN temporality = 'cumulative' THEN
				CASE WHEN lag(count) OVER w IS NULL THEN NULL
				     WHEN count < lag(count) OVER w THEN count
				     ELSE count - lag(count) OVER w END
			ELSE count
		END AS count_delta,
		CASE
			WHEN temporality = 'cumulative' THEN count
			WHEN temporality = 'delta' THEN sum(count) OVER w
			ELSE NULL
		END AS count_cumulative,
		CASE
			WHEN temporality = 'cumulative' THEN
				CASE WHEN lag(sum) OVER w IS NULL THEN NULL
				     WHEN sum < lag(sum) OVER w THEN sum
				     ELSE sum - lag(sum) OVER w END
			ELSE sum
		END AS sum_delta,
		CASE
			WHEN temporality = 'cumulative' THEN sum
			WHEN temporality = 'delta' THEN sum(sum) OVER w
			ELSE NULL
		END AS sum_cumulative,
		min, max
	FROM points
	WINDOW w AS (PARTITION BY request_index, series_key ORDER BY ts)
)
`

// metricDerivedCTE composes metricDerivedFormula onto the group/window-wide
// points selection MetricPoints and MetricAggregate share: every point across
// every attribute-series belonging to (service_name, metric_name) within
// [from, to). Placeholder order: service_name, metric_name, from (p.ts >=),
// to (p.ts <).
const metricDerivedCTE = `
WITH points AS (
	SELECT
		0 AS request_index,
		p.id, p.series_key, p.ts,
		coalesce(p.value_double, cast(p.value_int AS DOUBLE)) AS value,
		cast(p.count AS DOUBLE) AS count, p.sum, p.min, p.max,
		s.metric_type, s.temporality, s.is_monotonic, s.attributes::VARCHAR AS attrs_json
	FROM metric_points p
	JOIN metric_series s USING (series_key)
	WHERE s.service_name = ? AND s.metric_name = ? AND p.ts >= ? AND p.ts < ?
),
` + metricDerivedFormula

// metricPointsQuery derives per-point delta/cumulative values (via
// metricDerivedCTE) but merges every series belonging to the (service,
// metric) pair into one ts-ordered result, matching the old store package's
// "one MetricData, many attribute series" contract. metric_type rides along
// per row (not just fetched once at the group level) so a caller can filter
// baseline observations without a separate MetricSummary lookup — see
// DerivedPoint.Type and internal/storage's FilterDerivedPoints.
const metricPointsSelect = `
SELECT
	id, ts, attrs_json, metric_type,
	CASE
		WHEN metric_type IN ` + distributionTypesSQL + ` THEN
			CASE WHEN sum_delta IS NULL OR count_delta IS NULL OR count_delta <= 0 THEN 0
			     ELSE sum_delta / count_delta END
		ELSE scalar_value
	END AS out_value,
	CASE WHEN metric_type IN ` + distributionTypesSQL + ` THEN NULL ELSE scalar_cumulative END AS out_cumulative,
	CASE WHEN metric_type IN ` + distributionTypesSQL + ` THEN count_delta ELSE NULL END AS out_count,
	CASE WHEN metric_type IN ` + distributionTypesSQL + ` THEN count_cumulative ELSE NULL END AS out_count_cumulative,
	CASE WHEN metric_type IN ` + distributionTypesSQL + ` THEN sum_delta ELSE NULL END AS out_sum,
	CASE WHEN metric_type IN ` + distributionTypesSQL + ` THEN sum_cumulative ELSE NULL END AS out_sum_cumulative,
	min, max
FROM derived
ORDER BY ts
`

const metricPointsQuery = metricDerivedCTE + metricPointsSelect

// metricPointsWithPredecessorsQuery adds the immediately preceding point only
// for represented cumulative source series whose delta derivation uses lag().
// Gauge, delta, and cumulative non-monotonic Sum series stay window-only.
const metricPointsWithPredecessorsCTE = `
WITH target_series AS (
	SELECT series_key, metric_type, temporality, is_monotonic, attributes::VARCHAR AS attrs_json
	FROM metric_series
	WHERE service_name = ? AND metric_name = ?
),
window_points AS (
	SELECT
		0 AS request_index,
		p.id, p.series_key, p.ts,
		coalesce(p.value_double, cast(p.value_int AS DOUBLE)) AS value,
		cast(p.count AS DOUBLE) AS count, p.sum, p.min, p.max,
		s.metric_type, s.temporality, s.is_monotonic, s.attrs_json
	FROM metric_points p
	JOIN target_series s USING (series_key)
	WHERE p.ts >= ? AND p.ts < ?
),
represented_series AS (
	SELECT DISTINCT series_key FROM window_points
	WHERE ` + predecessorRequiredSQL + `
),
points AS (
	SELECT * FROM window_points
	UNION ALL
	SELECT request_index, id, series_key, ts, value, count, sum, min, max,
		metric_type, temporality, is_monotonic, attrs_json
	FROM (
		SELECT
			0 AS request_index,
			p.id, p.series_key, p.ts,
			coalesce(p.value_double, cast(p.value_int AS DOUBLE)) AS value,
			cast(p.count AS DOUBLE) AS count, p.sum, p.min, p.max,
			s.metric_type, s.temporality, s.is_monotonic, s.attrs_json,
			row_number() OVER (PARTITION BY p.series_key ORDER BY p.ts DESC, p.id DESC) AS predecessor_rank
		FROM metric_points p
		JOIN target_series s USING (series_key)
		JOIN represented_series r USING (series_key)
		WHERE p.ts < ?
	)
	WHERE predecessor_rank = 1
),
` + metricDerivedFormula

const metricPointsWithPredecessorsQuery = metricPointsWithPredecessorsCTE + metricPointsSelect

const metricPointsWithPredecessorsBatchQuery = `
WITH requested(request_index, service_name, metric_name, from_ns, to_ns) AS (VALUES %s),
target_series AS (
	SELECT r.request_index, make_timestamp_ns(r.from_ns) AS from_ts, make_timestamp_ns(r.to_ns) AS to_ts,
		s.series_key, s.metric_type, s.temporality, s.is_monotonic,
		s.attributes::VARCHAR AS attrs_json
	FROM requested r
	JOIN metric_series s USING (service_name, metric_name)
),
window_points AS (
	SELECT
		s.request_index, p.id, p.series_key, p.ts,
		coalesce(p.value_double, cast(p.value_int AS DOUBLE)) AS value,
		cast(p.count AS DOUBLE) AS count, p.sum, p.min, p.max,
		s.metric_type, s.temporality, s.is_monotonic, s.attrs_json
	FROM metric_points p
	JOIN target_series s USING (series_key)
	WHERE p.ts >= s.from_ts AND p.ts < s.to_ts
),
represented_series AS (
	SELECT DISTINCT request_index, series_key FROM window_points
	WHERE ` + predecessorRequiredSQL + `
),
points AS (
	SELECT * FROM window_points
	UNION ALL
	SELECT request_index, id, series_key, ts, value, count, sum, min, max,
		metric_type, temporality, is_monotonic, attrs_json
	FROM (
		SELECT
			s.request_index, p.id, p.series_key, p.ts,
			coalesce(p.value_double, cast(p.value_int AS DOUBLE)) AS value,
			cast(p.count AS DOUBLE) AS count, p.sum, p.min, p.max,
			s.metric_type, s.temporality, s.is_monotonic, s.attrs_json,
			row_number() OVER (
				PARTITION BY s.request_index, p.series_key ORDER BY p.ts DESC, p.id DESC
			) AS predecessor_rank
		FROM metric_points p
		JOIN target_series s USING (series_key)
		JOIN represented_series r USING (request_index, series_key)
		WHERE p.ts < s.from_ts
	)
	WHERE predecessor_rank = 1
),
` + metricDerivedFormula + `
SELECT
	request_index, id, ts, attrs_json, metric_type,
	CASE
		WHEN metric_type IN ` + distributionTypesSQL + ` THEN
			CASE WHEN sum_delta IS NULL OR count_delta IS NULL OR count_delta <= 0 THEN 0
			     ELSE sum_delta / count_delta END
		ELSE scalar_value
	END AS out_value,
	CASE WHEN metric_type IN ` + distributionTypesSQL + ` THEN NULL ELSE scalar_cumulative END AS out_cumulative,
	CASE WHEN metric_type IN ` + distributionTypesSQL + ` THEN count_delta ELSE NULL END AS out_count,
	CASE WHEN metric_type IN ` + distributionTypesSQL + ` THEN count_cumulative ELSE NULL END AS out_count_cumulative,
	CASE WHEN metric_type IN ` + distributionTypesSQL + ` THEN sum_delta ELSE NULL END AS out_sum,
	CASE WHEN metric_type IN ` + distributionTypesSQL + ` THEN sum_cumulative ELSE NULL END AS out_sum_cumulative,
	min, max
FROM derived
ORDER BY request_index, ts
`

// MetricPointWindow identifies one metric group and the newly committed time
// range whose derived points a broadcaster needs.
type MetricPointWindow struct {
	ServiceName string
	MetricName  string
	From        time.Time
	To          time.Time
}

// MetricPoints returns every data point across every attribute-series of the
// (serviceName, metricName) pair within [from, to), ordered by timestamp,
// with cumulative/delta values derived at query time.
func (s *Storage) MetricPoints(ctx context.Context, serviceName, metricName string, from, to time.Time) (points []DerivedPoint, err error) {
	ctx, span := startStorageSpan(ctx, "storage.MetricPoints")
	defer func() { endStorageSpan(span, err) }()
	started := time.Now()
	defer func() { s.recordQuery(ctx, "query_metric_points", started, err) }()
	return s.queryMetricPoints(ctx, metricPointsQuery, serviceName, metricName, from, to)
}

// MetricPointsWithPredecessors returns the requested points plus at most one
// older point for each represented cumulative source series that needs lag().
func (s *Storage) MetricPointsWithPredecessors(ctx context.Context, serviceName, metricName string, from, to time.Time) (points []DerivedPoint, err error) {
	ctx, span := startStorageSpan(ctx, "storage.MetricPointsWithPredecessors")
	defer func() { endStorageSpan(span, err) }()
	started := time.Now()
	defer func() { s.recordQuery(ctx, "query_metric_points", started, err) }()
	return s.queryMetricPoints(ctx, metricPointsWithPredecessorsQuery, serviceName, metricName, from, to, from)
}

// MetricPointsWithPredecessorsBatch derives multiple metric groups in one SQL
// statement, avoiding one parse/plan/execute cycle per group in an OTLP batch.
func (s *Storage) MetricPointsWithPredecessorsBatch(ctx context.Context, windows []MetricPointWindow) (result [][]DerivedPoint, err error) {
	if len(windows) == 0 {
		return [][]DerivedPoint{}, nil
	}
	ctx, span := startStorageSpan(ctx, "storage.MetricPointsWithPredecessorsBatch", attribute.Int("storage.batch.metric_count", len(windows)))
	defer func() { endStorageSpan(span, err) }()
	started := time.Now()
	defer func() { s.recordQuery(ctx, "query_metric_points_batch", started, err) }()

	values := make([]string, len(windows))
	args := make([]any, 0, len(windows)*5)
	for i, window := range windows {
		values[i] = "(?, ?, ?, ?, ?)"
		args = append(args, i, window.ServiceName, window.MetricName, window.From.UnixNano(), window.To.UnixNano())
	}
	query := fmt.Sprintf(metricPointsWithPredecessorsBatchQuery, strings.Join(values, ","))
	rows, err := s.DB().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("storage: query metric points batch: %w", err)
	}
	defer func() { _ = rows.Close() }()

	result = make([][]DerivedPoint, len(windows))
	for rows.Next() {
		var (
			requestIndex                                              int
			id                                                        duckdb.UUID
			ts                                                        time.Time
			attrsRaw                                                  *string
			metricType                                                string
			value, cumulative, count, countCum, sum, sumCum, min, max sql.NullFloat64
		)
		if err := rows.Scan(&requestIndex, &id, &ts, &attrsRaw, &metricType, &value, &cumulative, &count, &countCum, &sum, &sumCum, &min, &max); err != nil {
			return nil, fmt.Errorf("storage: scan metric point batch: %w", err)
		}
		attrs, err := decodeAttrs(attrsRaw)
		if err != nil {
			return nil, err
		}
		result[requestIndex] = append(result[requestIndex], DerivedPoint{
			ID: uuid.UUID(id), TS: ts, Type: metricType,
			Value: nullFloatPtr(value), Cumulative: nullFloatPtr(cumulative),
			Count: nullFloatPtr(count), CountCumulative: nullFloatPtr(countCum),
			Sum: nullFloatPtr(sum), SumCumulative: nullFloatPtr(sumCum),
			Min: nullFloatPtr(min), Max: nullFloatPtr(max), Attributes: attrs,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("storage: iterate metric points batch: %w", err)
	}
	return result, nil
}

func (s *Storage) queryMetricPoints(ctx context.Context, query string, args ...any) ([]DerivedPoint, error) {
	rows, err := s.DB().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("storage: query metric points: %w", err)
	}
	defer func() { _ = rows.Close() }()

	points := make([]DerivedPoint, 0)
	for rows.Next() {
		var (
			id                                                        duckdb.UUID
			ts                                                        time.Time
			attrsRaw                                                  *string
			metricType                                                string
			value, cumulative, count, countCum, sum, sumCum, min, max sql.NullFloat64
		)
		if err := rows.Scan(&id, &ts, &attrsRaw, &metricType, &value, &cumulative, &count, &countCum, &sum, &sumCum, &min, &max); err != nil {
			return nil, fmt.Errorf("storage: scan metric point: %w", err)
		}
		attrs, err := decodeAttrs(attrsRaw)
		if err != nil {
			return nil, err
		}
		points = append(points, DerivedPoint{
			ID:              uuid.UUID(id),
			TS:              ts,
			Type:            metricType,
			Value:           nullFloatPtr(value),
			Cumulative:      nullFloatPtr(cumulative),
			Count:           nullFloatPtr(count),
			CountCumulative: nullFloatPtr(countCum),
			Sum:             nullFloatPtr(sum),
			SumCumulative:   nullFloatPtr(sumCum),
			Min:             nullFloatPtr(min),
			Max:             nullFloatPtr(max),
			Attributes:      attrs,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("storage: iterate metric points: %w", err)
	}

	return points, nil
}

// metricLatestValueQuery reuses metricDerivedFormula's exact per-series delta
// derivation (so this can never silently drift from what MetricPoints
// returns for the same row) but restricts the `points` CTE to the group's
// single most-recently-active series and only that series' last two raw
// observations — enough rows for the derivation's lag() to resolve
// correctly (a series' points are never interleaved with another's under
// the same series_key) while staying O(1) per metric instead of re-deriving
// the group's entire retained history — the cost issue #162 exists to avoid
// paying at list-render time for every metric on the page.
//
// A baseline observation (nothing to derive a delta against yet) and a
// distribution window with zero/unresolved count both collapse to the same
// SQL NULL here — the metrics list only needs "is there a meaningful number
// to show," not the more detailed distinction MetricPoints' separate
// Value/Count nullability preserves for full history browsing.
const metricLatestValueQuery = `
WITH target AS (
	SELECT series_key FROM metric_series
	WHERE service_name = ? AND metric_name = ?
	ORDER BY last_seen DESC
	LIMIT 1
),
points AS (
	SELECT
		0 AS request_index,
		p.id, p.series_key, p.ts,
		coalesce(p.value_double, cast(p.value_int AS DOUBLE)) AS value,
		cast(p.count AS DOUBLE) AS count, p.sum, p.min, p.max,
		s.metric_type, s.temporality, s.is_monotonic, s.attributes::VARCHAR AS attrs_json
	FROM metric_points p
	JOIN metric_series s USING (series_key)
	WHERE p.series_key = (SELECT series_key FROM target)
	ORDER BY p.ts DESC
	LIMIT 2
),
` + metricDerivedFormula + `
SELECT
	CASE
		WHEN metric_type IN ` + distributionTypesSQL + ` THEN
			CASE WHEN sum_delta IS NULL OR count_delta IS NULL OR count_delta <= 0 THEN NULL
			     ELSE sum_delta / count_delta END
		ELSE scalar_value
	END AS out_value
FROM derived
ORDER BY ts DESC
LIMIT 1
`

// LatestValue returns the derived value of the most recent observation from
// a (service, metric) group's most-recently-active series — the metrics
// list's cheap glance column (see internal/graphql's Metric.latestValue).
// Returns (nil, nil) when the group has no series/points at all, or its
// latest observation has no meaningful value yet (see metricLatestValueQuery's
// doc comment).
func (s *Storage) LatestValue(ctx context.Context, serviceName, metricName string) (value *float64, err error) {
	ctx, span := startStorageSpan(ctx, "storage.LatestValue")
	defer func() { endStorageSpan(span, err) }()
	started := time.Now()
	defer func() { s.recordQuery(ctx, "query_metric_latest_value", started, err) }()
	var latest sql.NullFloat64
	err = s.DB().QueryRowContext(ctx, metricLatestValueQuery, serviceName, metricName).Scan(&latest)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("storage: query metric latest value: %w", err)
	}
	return nullFloatPtr(latest), nil
}

func nullFloatPtr(v sql.NullFloat64) *float64 {
	if !v.Valid {
		return nil
	}
	f := v.Float64
	return &f
}
