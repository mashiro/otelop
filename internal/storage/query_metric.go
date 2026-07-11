package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	duckdb "github.com/duckdb/duckdb-go/v2"
	"github.com/google/uuid"
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
	// caller filtering baseline observations (see internal/graphql's
	// filterDerivedPoints) can decide which of Value/Count is the
	// meaningful field without a separate group-metadata lookup — the
	// top-level metricPoints query (issue #162) has no MetricSummary in
	// hand the way MetricResolver does.
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
ORDER BY last_seen DESC
LIMIT ? OFFSET ?
`

const metricsTotalQuery = `
SELECT count(*) FROM (
	SELECT 1 FROM metric_series
	WHERE first_seen < ? AND last_seen >= ?
	GROUP BY service_name, metric_name
)
`

// MetricsPage returns a page of metric groups (one per distinct
// service+metric name pair, most-recently-active first) plus the total
// group count.
func (s *Storage) MetricsPage(ctx context.Context, from, to time.Time, offset, limit int) ([]MetricSummary, int, error) {
	var total int
	if err := s.DB().QueryRowContext(ctx, metricsTotalQuery, to, from).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("storage: count metrics page: %w", err)
	}

	rows, err := s.DB().QueryContext(ctx, metricsPageQuery, to, from, pageLimit(limit), offset)
	if err != nil {
		return nil, 0, fmt.Errorf("storage: query metrics page: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items := make([]MetricSummary, 0)
	for rows.Next() {
		var (
			m           MetricSummary
			seriesKeys  any
			resourceRaw *string
		)
		if err := rows.Scan(&m.ServiceName, &m.MetricName, &m.Type, &m.Unit, &m.Description, &m.LastSeen, &seriesKeys, &resourceRaw); err != nil {
			return nil, 0, fmt.Errorf("storage: scan metric summary: %w", err)
		}
		m.SeriesKeys = decodeSeriesKeys(seriesKeys)
		resource, err := decodeAttrs(resourceRaw)
		if err != nil {
			return nil, 0, err
		}
		m.Resource = resource
		items = append(items, m)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("storage: iterate metrics page: %w", err)
	}

	return items, total, nil
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
// with columns id, series_key, ts, value, count, sum, min, max, metric_type,
// temporality, is_monotonic, attrs_json — metricDerivedCTE below supplies the
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
		id, ts, attrs_json, metric_type,
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
	WINDOW w AS (PARTITION BY series_key ORDER BY ts)
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
		p.id, p.series_key, p.ts, p.value, p.count, p.sum, p.min, p.max,
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
// DerivedPoint.Type and internal/graphql's filterDerivedPoints.
const metricPointsQuery = metricDerivedCTE + `
SELECT
	id, ts, attrs_json, metric_type,
	CASE
		WHEN metric_type IN ('Histogram', 'ExponentialHistogram', 'Summary') THEN
			CASE WHEN sum_delta IS NULL OR count_delta IS NULL OR count_delta <= 0 THEN 0
			     ELSE sum_delta / count_delta END
		ELSE scalar_value
	END AS out_value,
	CASE WHEN metric_type IN ('Histogram', 'ExponentialHistogram', 'Summary') THEN NULL ELSE scalar_cumulative END AS out_cumulative,
	CASE WHEN metric_type IN ('Histogram', 'ExponentialHistogram', 'Summary') THEN count_delta ELSE NULL END AS out_count,
	CASE WHEN metric_type IN ('Histogram', 'ExponentialHistogram', 'Summary') THEN count_cumulative ELSE NULL END AS out_count_cumulative,
	CASE WHEN metric_type IN ('Histogram', 'ExponentialHistogram', 'Summary') THEN sum_delta ELSE NULL END AS out_sum,
	CASE WHEN metric_type IN ('Histogram', 'ExponentialHistogram', 'Summary') THEN sum_cumulative ELSE NULL END AS out_sum_cumulative,
	min, max
FROM derived
ORDER BY ts
`

// MetricPoints returns every data point across every attribute-series of the
// (serviceName, metricName) pair within [from, to), ordered by timestamp,
// with cumulative/delta values derived at query time.
func (s *Storage) MetricPoints(ctx context.Context, serviceName, metricName string, from, to time.Time) ([]DerivedPoint, error) {
	rows, err := s.DB().QueryContext(ctx, metricPointsQuery, serviceName, metricName, from, to)
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
		p.id, p.series_key, p.ts, p.value, p.count, p.sum, p.min, p.max,
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
		WHEN metric_type IN ('Histogram', 'ExponentialHistogram', 'Summary') THEN
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
func (s *Storage) LatestValue(ctx context.Context, serviceName, metricName string) (*float64, error) {
	var value sql.NullFloat64
	err := s.DB().QueryRowContext(ctx, metricLatestValueQuery, serviceName, metricName).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("storage: query metric latest value: %w", err)
	}
	return nullFloatPtr(value), nil
}

func nullFloatPtr(v sql.NullFloat64) *float64 {
	if !v.Valid {
		return nil
	}
	f := v.Float64
	return &f
}
