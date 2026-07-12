package storage

import (
	"context"
	"os"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

type queryTelemetry struct {
	duration metric.Float64Histogram
	errors   metric.Int64Counter
}

type duckDBStats struct {
	databaseSize int64
	walSize      int64
	totalBlocks  int64
	usedBlocks   int64
	freeBlocks   int64
	memoryUsage  int64
	tempUsage    int64
}

// RegisterTelemetry enables DuckDB telemetry on this store. The caller only
// invokes it in debug mode, after the self-telemetry MeterProvider is ready.
func (s *Storage) RegisterTelemetry(meter metric.Meter) error {
	duration, err := meter.Float64Histogram("otelop.duckdb.query.duration",
		metric.WithUnit("s"),
		metric.WithDescription("DuckDB query duration by storage operation"),
	)
	if err != nil {
		return err
	}
	errorsCounter, err := meter.Int64Counter("otelop.duckdb.query.errors",
		metric.WithUnit("{error}"),
		metric.WithDescription("DuckDB query errors by storage operation"),
	)
	if err != nil {
		return err
	}
	s.queryTelemetry.Store(&queryTelemetry{duration: duration, errors: errorsCounter})

	databaseSize, err := meter.Int64ObservableGauge("otelop.duckdb.database.size",
		metric.WithUnit("By"), metric.WithDescription("Allocated DuckDB database size"))
	if err != nil {
		return err
	}
	walSize, err := meter.Int64ObservableGauge("otelop.duckdb.wal.size",
		metric.WithUnit("By"), metric.WithDescription("DuckDB write-ahead log size"))
	if err != nil {
		return err
	}
	totalBlocks, err := meter.Int64ObservableGauge("otelop.duckdb.blocks.total",
		metric.WithUnit("{block}"), metric.WithDescription("Total DuckDB storage blocks"))
	if err != nil {
		return err
	}
	usedBlocks, err := meter.Int64ObservableGauge("otelop.duckdb.blocks.used",
		metric.WithUnit("{block}"), metric.WithDescription("Used DuckDB storage blocks"))
	if err != nil {
		return err
	}
	freeBlocks, err := meter.Int64ObservableGauge("otelop.duckdb.blocks.free",
		metric.WithUnit("{block}"), metric.WithDescription("Reusable free DuckDB storage blocks"))
	if err != nil {
		return err
	}
	memoryUsage, err := meter.Int64ObservableGauge("otelop.duckdb.memory.usage",
		metric.WithUnit("By"), metric.WithDescription("DuckDB buffer manager memory usage"))
	if err != nil {
		return err
	}
	tempUsage, err := meter.Int64ObservableGauge("otelop.duckdb.temporary_storage.usage",
		metric.WithUnit("By"), metric.WithDescription("DuckDB temporary storage usage"))
	if err != nil {
		return err
	}

	_, err = meter.RegisterCallback(func(ctx context.Context, observer metric.Observer) error {
		stats, err := s.duckDBStats(ctx)
		if err != nil {
			return err
		}
		observer.ObserveInt64(databaseSize, stats.databaseSize)
		observer.ObserveInt64(walSize, stats.walSize)
		observer.ObserveInt64(totalBlocks, stats.totalBlocks)
		observer.ObserveInt64(usedBlocks, stats.usedBlocks)
		observer.ObserveInt64(freeBlocks, stats.freeBlocks)
		observer.ObserveInt64(memoryUsage, stats.memoryUsage)
		observer.ObserveInt64(tempUsage, stats.tempUsage)
		return nil
	}, databaseSize, walSize, totalBlocks, usedBlocks, freeBlocks, memoryUsage, tempUsage)
	return err
}

func (s *Storage) recordQuery(ctx context.Context, operation string, started time.Time, err error) {
	telemetry := s.queryTelemetry.Load()
	if telemetry == nil {
		return
	}
	options := metric.WithAttributes(attribute.String("operation", operation))
	telemetry.duration.Record(ctx, time.Since(started).Seconds(), options)
	if err != nil {
		telemetry.errors.Add(ctx, 1, options)
	}
}

func (s *Storage) duckDBStats(ctx context.Context) (duckDBStats, error) {
	var stats duckDBStats
	var blockSize int64
	err := s.db.QueryRowContext(ctx, `
		SELECT block_size, total_blocks, used_blocks, free_blocks
		FROM pragma_database_size()
		WHERE database_name = current_database()
	`).Scan(&blockSize, &stats.totalBlocks, &stats.usedBlocks, &stats.freeBlocks)
	if err != nil {
		return duckDBStats{}, err
	}
	stats.databaseSize = blockSize * stats.totalBlocks

	if err := s.db.QueryRowContext(ctx, `
		SELECT coalesce(sum(memory_usage_bytes), 0), coalesce(sum(temporary_storage_bytes), 0)
		FROM duckdb_memory()
	`).Scan(&stats.memoryUsage, &stats.tempUsage); err != nil {
		return duckDBStats{}, err
	}

	if s.opts.Path != "" {
		info, err := os.Stat(s.opts.Path + ".wal")
		if err == nil {
			stats.walSize = info.Size()
		} else if !os.IsNotExist(err) {
			return duckDBStats{}, err
		}
	}
	return stats, nil
}
