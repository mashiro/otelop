package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
)

// AggregatePoint is one time-bucketed, cross-series-summed observation —
// the facet-aggregated counterpart to DerivedPoint. Unlike DerivedPoint it
// carries no Cumulative field: a running total only makes sense per series,
// not summed across a facet group over time (see docs/design/duckdb-storage.md
// and the task this implements). Value is the scalar sum for Gauge/Sum
// metrics, or the summed-sum/summed-count mean for distributions; Count/Sum
// mirror the per-bucket summed deltas for distributions (nil for Gauge/Sum);
// Min/Max are the per-bucket min/max across every contributing series.
type AggregatePoint struct {
	TS    time.Time
	Value *float64
	Count *float64
	Sum   *float64
	Min   *float64
	Max   *float64
}

// AggregateSeries is every point sharing one facet group's attribute values,
// e.g. groupBy ["region"] with GroupValues ["us-east"].
type AggregateSeries struct {
	GroupValues []string
	Points      []AggregatePoint
}

// metricAggregateTargetBuckets is the number of buckets auto-bucketing aims
// for across a metric's actual data extent — see MetricAggregate's doc
// comment on why this must be measured against real data, not a fixed
// fallback window.
const metricAggregateTargetBuckets = 150

// MetricAggregate sums metricDerivedCTE's per-series derivation (deltas
// already resolved per attribute-series — counter resets included, see
// metricDerivedCTE's doc comment) into one bucketed, per-facet-group series.
// This is the fix for the chart's facet view concatenating raw points from
// every underlying series instead of summing them: summing must happen AFTER
// the per-series delta derivation, never before, or a counter reset in one
// series would corrupt the group's total.
//
// bucket == 0 means "auto": the bucket width is derived from the (service,
// metric) pair's actual min/max timestamp within [from, to) rather than a
// fixed assumption about the query window (e.g. the full retention period),
// which for a short-lived metric queried over a long/unbounded window would
// collapse every point into a handful of giant buckets. See
// metricAggregateAutoBucket. bucket < 0 is still an error.
//
// groupBy attribute values are read from metric_series.attributes (via the
// derived CTE's attrs_json passthrough); a series missing a groupBy key
// contributes to the "" (empty string) group for that key, so "missing
// attribute" groups cleanly instead of silently dropping the series.
//
// Bucket boundaries come from DuckDB's time_bucket, which — confirmed
// empirically against this driver — operates directly on TIMESTAMP_NS
// without truncating precision, so no epoch-arithmetic fallback is needed.
//
// A bucket+group row is dropped when scalar_value/count_delta/sum_delta are
// ALL NULL — the group-wide equivalent of MetricResolver.filteredPoints's
// "drop baseline-only rows" filter (Value/Count nil). Min/Max deliberately
// don't gate the drop: unlike value/count/sum they are raw passthrough, not
// delta-derived, so a bucket containing only a series' very first
// observation still has a real min/max worth keeping even though it has no
// delta yet.
func (s *Storage) MetricAggregate(ctx context.Context, serviceName, metricName string, groupBy []string, bucket time.Duration, from, to time.Time) (series []AggregateSeries, err error) {
	ctx, span := startStorageSpan(ctx, "storage.MetricAggregate",
		attribute.Int("metric.group_by.count", len(groupBy)), attribute.Int64("metric.bucket_ms", bucket.Milliseconds()))
	defer func() { endStorageSpan(span, err) }()
	started := time.Now()
	defer func() { s.recordQuery(ctx, "query_metric_aggregate", started, err) }()
	if len(groupBy) == 0 {
		return nil, errors.New("storage: MetricAggregate requires at least one groupBy attribute")
	}
	if bucket < 0 {
		return nil, errors.New("storage: MetricAggregate requires a non-negative bucket duration")
	}
	if bucket == 0 {
		auto, err := s.metricAggregateAutoBucket(ctx, serviceName, metricName, from, to)
		if err != nil {
			return nil, err
		}
		bucket = auto
	}

	groupCols := make([]string, len(groupBy))
	groupOrdinals := make([]string, len(groupBy))
	for i := range groupBy {
		groupCols[i] = fmt.Sprintf("group_%d", i+1)
		// Column 1 is the bucket; group columns follow at 2..len(groupBy)+1.
		groupOrdinals[i] = fmt.Sprintf("%d", i+2)
	}
	groupColList := strings.Join(groupCols, ", ")

	selectGroupCols := make([]string, len(groupBy))
	for i := range groupBy {
		selectGroupCols[i] = fmt.Sprintf("COALESCE(attrs_json::JSON->>?, '') AS %s", groupCols[i])
	}

	query := metricDerivedCTE + `,
aggregated AS (
	SELECT
		time_bucket(?::BIGINT * INTERVAL '1 second', ts) AS bucket,
		` + strings.Join(selectGroupCols, ",\n\t\t") + `,
		max(metric_type) AS metric_type,
		sum(scalar_value) AS scalar_value_sum,
		sum(count_delta) AS count_sum,
		sum(sum_delta) AS sum_sum,
		min(min) AS min_min,
		max(max) AS max_max
	FROM derived
	GROUP BY 1, ` + strings.Join(groupOrdinals, ", ") + `
	HAVING NOT (scalar_value_sum IS NULL AND count_sum IS NULL AND sum_sum IS NULL)
)
SELECT
	bucket, ` + groupColList + `,
	CASE
		WHEN metric_type IN ` + distributionTypesSQL + ` THEN
			CASE WHEN count_sum IS NULL OR count_sum <= 0 THEN 0 ELSE sum_sum / count_sum END
		ELSE scalar_value_sum
	END AS out_value,
	CASE WHEN metric_type IN ` + distributionTypesSQL + ` THEN count_sum ELSE NULL END AS out_count,
	CASE WHEN metric_type IN ` + distributionTypesSQL + ` THEN sum_sum ELSE NULL END AS out_sum,
	min_min, max_max
FROM aggregated
ORDER BY ` + groupColList + `, bucket
`

	args := make([]any, 0, 5+len(groupBy))
	args = append(args, serviceName, metricName, from, to, int64(bucket/time.Second))
	for _, k := range groupBy {
		args = append(args, k)
	}

	rows, err := s.DB().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("storage: query metric aggregate: %w", err)
	}
	defer func() { _ = rows.Close() }()

	// seriesByKey preserves first-seen order (matching the SQL's ORDER BY
	// group values) while letting rows for the same group land in the same
	// AggregateSeries even though SQL emits one row per (group, bucket).
	seriesByKey := make(map[string]*AggregateSeries)
	order := make([]string, 0)

	for rows.Next() {
		var (
			ts                            time.Time
			groupValues                   = make([]any, len(groupBy))
			groupValuesScan               = make([]any, len(groupBy))
			value, count, sum, minV, maxV sql.NullFloat64
		)
		for i := range groupValues {
			groupValuesScan[i] = &groupValues[i]
		}
		dest := append([]any{&ts}, groupValuesScan...)
		dest = append(dest, &value, &count, &sum, &minV, &maxV)
		if err := rows.Scan(dest...); err != nil {
			return nil, fmt.Errorf("storage: scan metric aggregate: %w", err)
		}

		values := make([]string, len(groupBy))
		for i, v := range groupValues {
			str, _ := v.(string)
			values[i] = str
		}
		key := strings.Join(values, "\x00")

		series, ok := seriesByKey[key]
		if !ok {
			series = &AggregateSeries{GroupValues: values}
			seriesByKey[key] = series
			order = append(order, key)
		}
		series.Points = append(series.Points, AggregatePoint{
			TS:    ts,
			Value: nullFloatPtr(value),
			Count: nullFloatPtr(count),
			Sum:   nullFloatPtr(sum),
			Min:   nullFloatPtr(minV),
			Max:   nullFloatPtr(maxV),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("storage: iterate metric aggregate: %w", err)
	}

	out := make([]AggregateSeries, 0, len(order))
	for _, key := range order {
		out = append(out, *seriesByKey[key])
	}
	return out, nil
}

// metricAggregateAutoBucket picks a bucket width targeting roughly
// metricAggregateTargetBuckets buckets across the (service, metric) pair's
// actual data extent within [from, to) — never the requested window itself,
// since "all time" queries have no fixed width to divide by. An empty extent
// (no points in range) or a single-instant extent (min == max) has nothing
// to divide, so it falls back to the smallest bucket, 1 second.
func (s *Storage) metricAggregateAutoBucket(ctx context.Context, serviceName, metricName string, from, to time.Time) (time.Duration, error) {
	var minTS, maxTS sql.NullTime
	err := s.DB().QueryRowContext(ctx, `
		SELECT min(p.ts), max(p.ts)
		FROM metric_points p
		JOIN metric_series s USING (series_key)
		WHERE s.service_name = ? AND s.metric_name = ? AND p.ts >= ? AND p.ts < ?
	`, serviceName, metricName, from, to).Scan(&minTS, &maxTS)
	if err != nil {
		return 0, fmt.Errorf("storage: query metric aggregate auto-bucket extent: %w", err)
	}
	if !minTS.Valid || !maxTS.Valid {
		return time.Second, nil
	}
	span := maxTS.Time.Sub(minTS.Time)
	if bucket := span / metricAggregateTargetBuckets; bucket > time.Second {
		return bucket, nil
	}
	return time.Second, nil
}
