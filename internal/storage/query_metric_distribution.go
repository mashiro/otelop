package storage

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"time"
)

// DistributionStats summarizes all histogram observations whose export
// timestamps fall in one metric window. Percentiles are estimates from the
// retained buckets; they are never averages of per-point percentiles.
type DistributionStats struct {
	Count int64
	Mean  *float64
	Min   *float64
	Max   *float64
	P50   *float64
	P90   *float64
	P95   *float64
	P99   *float64
}

type histogramPoint struct {
	seriesKey                      uint64
	inWindow                       bool
	temporality                    string
	startTS                        sql.NullTime
	count                          sql.Null[uint64]
	sum, min, max                  sql.NullFloat64
	layoutHash                     sql.Null[uint64]
	kind                           string
	bounds                         []float64
	scale                          sql.NullInt64
	zeroThreshold                  sql.NullFloat64
	bucketCounts                   []uint64
	zeroCount                      sql.Null[uint64]
	positiveOffset, negativeOffset sql.NullInt64
	positiveCounts, negativeCounts []uint64
}

type distributionBucket struct {
	low, high   float64
	count       float64
	logarithmic bool
}

// MetricDistributionStats returns window-wide statistics for Histogram and
// ExponentialHistogram metrics. Summary quantiles cannot be merged across
// points or attribute series, so Summary intentionally returns nil.
func (s *Storage) MetricDistributionStats(ctx context.Context, serviceName, metricName string, from, to time.Time) (_ *DistributionStats, err error) {
	ctx, span := startStorageSpan(ctx, "storage.MetricDistributionStats")
	defer func() { endStorageSpan(span, err) }()
	started := time.Now()
	defer func() { s.recordQuery(ctx, "query_metric_distribution_stats", started, err) }()

	rows, err := s.DB().QueryContext(ctx, metricDistributionPointsQuery, serviceName, metricName, from, to, from)
	if err != nil {
		return nil, fmt.Errorf("storage: query metric distribution stats: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var previous *histogramPoint
	var buckets []distributionBucket
	var totalCount, totalSum float64
	sumComplete := true
	var minValue, maxValue *float64
	minMaxComplete := true
	for rows.Next() {
		point, scanErr := scanHistogramPoint(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		if !point.inWindow {
			previous = point
			continue
		}

		counts := pointCounts(point)
		count := nullableUint64Float(point.count)
		sum := nullableFloat(point.sum)
		reset := false
		if point.temporality == "cumulative" {
			if previous == nil || previous.seriesKey != point.seriesKey ||
				!point.layoutHash.Valid || !previous.layoutHash.Valid || point.layoutHash.V != previous.layoutHash.V {
				previous = point
				continue
			}
			previousCounts := pointCounts(previous)
			if point.startTS.Valid && previous.startTS.Valid && !point.startTS.Time.Equal(previous.startTS.Time) {
				reset = true
			} else if point.count.Valid && previous.count.Valid && point.count.V < previous.count.V {
				reset = true
			} else {
				var ok bool
				counts, ok = subtractCounts(counts, previousCounts)
				if !ok {
					reset = true
					counts = pointCounts(point)
				} else {
					count = subtractNullableUint64(point.count, previous.count)
					sum = subtractNullable(point.sum, previous.sum)
				}
			}
		}

		if count != nil && *count > 0 {
			totalCount += *count
		}
		if sum != nil {
			totalSum += *sum
		} else {
			sumComplete = false
		}
		// Delta points (and a cumulative reset, which is a fresh delta) carry
		// interval min/max. Normal cumulative min/max describe the whole stream
		// and cannot be subtracted, so don't mislabel them as window extrema.
		if point.temporality != "cumulative" || reset {
			minValue = minPointer(minValue, nullableFloat(point.min))
			maxValue = maxPointer(maxValue, nullableFloat(point.max))
		} else {
			minMaxComplete = false
		}
		buckets = append(buckets, bucketsForPoint(point, counts)...)
		previous = point
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("storage: iterate metric distribution stats: %w", err)
	}
	if totalCount <= 0 || len(buckets) == 0 {
		return nil, nil
	}
	stats := &DistributionStats{Count: int64(totalCount)}
	if sumComplete {
		mean := totalSum / totalCount
		stats.Mean = &mean
	}
	if minMaxComplete {
		stats.Min, stats.Max = minValue, maxValue
	}
	stats.P50 = histogramQuantile(buckets, 0.50)
	stats.P90 = histogramQuantile(buckets, 0.90)
	stats.P95 = histogramQuantile(buckets, 0.95)
	stats.P99 = histogramQuantile(buckets, 0.99)
	return stats, nil
}

const metricDistributionPointsQuery = `
WITH target_series AS (
	SELECT series_key, temporality FROM metric_series
	WHERE service_name = ? AND metric_name = ?
		AND metric_type IN ('Histogram', 'ExponentialHistogram')
), window_points AS (
	SELECT p.*, s.temporality, true AS in_window
	FROM metric_points p JOIN target_series s USING (series_key)
	WHERE p.ts >= ? AND p.ts < ?
), represented_series AS (SELECT DISTINCT series_key FROM window_points),
predecessor_points AS (
	SELECT p.*, s.temporality, false AS in_window
	FROM metric_points p JOIN target_series s USING (series_key)
	JOIN represented_series r USING (series_key)
	WHERE p.ts < ?
	QUALIFY row_number() OVER (PARTITION BY p.series_key ORDER BY p.ts DESC, p.id DESC) = 1
),
points AS (
	SELECT * FROM window_points
	UNION ALL BY NAME
	SELECT * FROM predecessor_points
)
SELECT p.series_key, p.in_window, p.temporality, p.start_ts, p.count, p.sum, p.min, p.max,
	p.histogram_layout_hash, coalesce(l.kind, ''), l.explicit_bounds, l.scale, l.zero_threshold,
	p.bucket_counts, p.zero_count, p.positive_offset, p.positive_bucket_counts,
	p.negative_offset, p.negative_bucket_counts
FROM points p LEFT JOIN histogram_layouts l ON l.layout_hash = p.histogram_layout_hash
ORDER BY p.series_key, p.ts, p.id`

func scanHistogramPoint(rows *sql.Rows) (*histogramPoint, error) {
	p := &histogramPoint{}
	var boundsRaw, bucketCountsRaw, positiveCountsRaw, negativeCountsRaw any
	if err := rows.Scan(&p.seriesKey, &p.inWindow, &p.temporality, &p.startTS, &p.count, &p.sum, &p.min, &p.max,
		&p.layoutHash, &p.kind, &boundsRaw, &p.scale, &p.zeroThreshold, &bucketCountsRaw,
		&p.zeroCount, &p.positiveOffset, &positiveCountsRaw, &p.negativeOffset, &negativeCountsRaw); err != nil {
		return nil, fmt.Errorf("storage: scan metric distribution point: %w", err)
	}
	var err error
	if p.bounds, err = float64List(boundsRaw); err != nil {
		return nil, err
	}
	if p.bucketCounts, err = uint64List(bucketCountsRaw); err != nil {
		return nil, err
	}
	if p.positiveCounts, err = uint64List(positiveCountsRaw); err != nil {
		return nil, err
	}
	if p.negativeCounts, err = uint64List(negativeCountsRaw); err != nil {
		return nil, err
	}
	return p, nil
}

func float64List(raw any) ([]float64, error) {
	if raw == nil {
		return nil, nil
	}
	values, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("storage: unexpected histogram bounds type %T", raw)
	}
	result := make([]float64, len(values))
	for i, value := range values {
		var ok bool
		result[i], ok = value.(float64)
		if !ok {
			return nil, fmt.Errorf("storage: unexpected histogram bound type %T", value)
		}
	}
	return result, nil
}

func uint64List(raw any) ([]uint64, error) {
	if raw == nil {
		return nil, nil
	}
	values, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("storage: unexpected histogram counts type %T", raw)
	}
	result := make([]uint64, len(values))
	for i, value := range values {
		var ok bool
		result[i], ok = value.(uint64)
		if !ok {
			return nil, fmt.Errorf("storage: unexpected histogram count type %T", value)
		}
	}
	return result, nil
}

func pointCounts(p *histogramPoint) []uint64 {
	if p.kind == "explicit" {
		return append([]uint64(nil), p.bucketCounts...)
	}
	counts := make([]uint64, 0, len(p.negativeCounts)+1+len(p.positiveCounts))
	counts = append(counts, p.negativeCounts...)
	counts = append(counts, p.zeroCount.V)
	counts = append(counts, p.positiveCounts...)
	return counts
}

func subtractCounts(current, previous []uint64) ([]uint64, bool) {
	if len(current) != len(previous) {
		return nil, false
	}
	result := make([]uint64, len(current))
	for i := range current {
		if current[i] < previous[i] {
			return nil, false
		}
		result[i] = current[i] - previous[i]
	}
	return result, true
}

func bucketsForPoint(p *histogramPoint, counts []uint64) []distributionBucket {
	if p.kind == "explicit" {
		if len(counts) != len(p.bounds)+1 {
			return nil
		}
		result := make([]distributionBucket, 0, len(counts))
		for i, count := range counts {
			if count == 0 {
				continue
			}
			low, high := math.Inf(-1), math.Inf(1)
			if i > 0 {
				low = p.bounds[i-1]
			}
			if i < len(p.bounds) {
				high = p.bounds[i]
			}
			if math.IsInf(low, -1) {
				if p.min.Valid {
					low = p.min.Float64
				} else {
					low = math.Min(0, high)
				}
			}
			if math.IsInf(high, 1) {
				if p.max.Valid {
					high = p.max.Float64
				} else {
					high = math.Max(0, low)
				}
			}
			result = append(result, distributionBucket{low: low, high: high, count: float64(count)})
		}
		return result
	}
	if p.kind != "exponential" || !p.scale.Valid {
		return nil
	}
	negativeLen := len(p.negativeCounts)
	if len(counts) != negativeLen+1+len(p.positiveCounts) {
		return nil
	}
	base := math.Pow(2, math.Pow(2, -float64(p.scale.Int64)))
	result := make([]distributionBucket, 0, len(counts))
	for i := 0; i < negativeLen; i++ {
		if counts[i] == 0 {
			continue
		}
		index := int64(p.negativeOffset.Int64) + int64(i)
		lowerMagnitude, upperMagnitude := math.Pow(base, float64(index)), math.Pow(base, float64(index+1))
		result = append(result, distributionBucket{low: -upperMagnitude, high: -lowerMagnitude, count: float64(counts[i]), logarithmic: true})
	}
	if zero := counts[negativeLen]; zero > 0 {
		threshold := p.zeroThreshold.Float64
		result = append(result, distributionBucket{low: -threshold, high: threshold, count: float64(zero)})
	}
	for i := range p.positiveCounts {
		count := counts[negativeLen+1+i]
		if count == 0 {
			continue
		}
		index := int64(p.positiveOffset.Int64) + int64(i)
		result = append(result, distributionBucket{low: math.Pow(base, float64(index)), high: math.Pow(base, float64(index+1)), count: float64(count), logarithmic: true})
	}
	return result
}

func histogramQuantile(buckets []distributionBucket, q float64) *float64 {
	var total float64
	low, high := math.Inf(1), math.Inf(-1)
	for _, bucket := range buckets {
		total += bucket.count
		low = math.Min(low, bucket.low)
		high = math.Max(high, bucket.high)
	}
	if total <= 0 || math.IsInf(low, 0) || math.IsInf(high, 0) {
		return nil
	}
	target := q * total
	for range 80 {
		mid := low + (high-low)/2
		if histogramCDF(buckets, mid) < target {
			low = mid
		} else {
			high = mid
		}
	}
	value := low + (high-low)/2
	return &value
}

func histogramCDF(buckets []distributionBucket, x float64) float64 {
	var result float64
	for _, bucket := range buckets {
		if x < bucket.low {
			continue
		}
		if x >= bucket.high || bucket.high <= bucket.low {
			result += bucket.count
			continue
		}
		fraction := (x - bucket.low) / (bucket.high - bucket.low)
		if bucket.logarithmic && bucket.low > 0 {
			fraction = math.Log(x/bucket.low) / math.Log(bucket.high/bucket.low)
		} else if bucket.logarithmic && bucket.high < 0 {
			fraction = math.Log(math.Abs(bucket.low)/math.Abs(x)) / math.Log(math.Abs(bucket.low)/math.Abs(bucket.high))
		}
		result += bucket.count * fraction
	}
	return result
}

func nullableFloat(v sql.NullFloat64) *float64 {
	if !v.Valid {
		return nil
	}
	value := v.Float64
	return &value
}

func nullableUint64Float(v sql.Null[uint64]) *float64 {
	if !v.Valid {
		return nil
	}
	value := float64(v.V)
	return &value
}

func subtractNullableUint64(current, previous sql.Null[uint64]) *float64 {
	if !current.Valid || !previous.Valid || current.V < previous.V {
		return nil
	}
	value := float64(current.V - previous.V)
	return &value
}

func subtractNullable(current, previous sql.NullFloat64) *float64 {
	if !current.Valid || !previous.Valid {
		return nil
	}
	value := current.Float64 - previous.Float64
	return &value
}

func minPointer(current, candidate *float64) *float64 {
	if candidate == nil {
		return current
	}
	if current == nil || *candidate < *current {
		value := *candidate
		return &value
	}
	return current
}

func maxPointer(current, candidate *float64) *float64 {
	if candidate == nil {
		return current
	}
	if current == nil || *candidate > *current {
		value := *candidate
		return &value
	}
	return current
}
