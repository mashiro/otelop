package storage

import (
	"context"
	"fmt"
	"time"
)

// TableRowCount is one table's logical row count, in the stable order
// Stats.Tables reports them.
type TableRowCount struct {
	Name string
	Rows int64
}

// Stats is the combined DuckDB engine, table, and data-extent overview for
// this database.
type Stats struct {
	DatabaseSizeBytes int64
	WALSizeBytes      int64
	TotalBlocks       int64
	UsedBlocks        int64
	FreeBlocks        int64
	MemoryUsageBytes  int64
	TempStorageBytes  int64

	// FileSizeBytes is always 0 for an in-memory database.
	FileBacked    bool
	FileSizeBytes int64

	Tables []TableRowCount

	OldestTimestamp time.Time
	NewestTimestamp time.Time
	// HasData is false when every fact table is empty, in which case
	// OldestTimestamp/NewestTimestamp carry no meaning.
	HasData bool
}

// MaxSize is the numeric counterpart to RuntimeInfo.MaxSizeDisplay's human string.
func (s *Storage) MaxSize() int64 { return s.opts.MaxSize }

// Retention is the numeric counterpart to RuntimeInfo.RetentionDisplay's human string.
func (s *Storage) Retention() time.Duration { return s.opts.Retention }

func (s *Storage) Stats(ctx context.Context) (Stats, error) {
	duck, err := s.duckDBStats(ctx)
	if err != nil {
		return Stats{}, fmt.Errorf("storage: stats: %w", err)
	}
	db, err := s.DBStats(ctx)
	if err != nil {
		return Stats{}, fmt.Errorf("storage: stats: %w", err)
	}
	oldest, newest, hasData, err := oldestNewestFactTimestamp(ctx, s.DB())
	if err != nil {
		return Stats{}, fmt.Errorf("storage: stats: oldest/newest fact timestamp: %w", err)
	}

	return Stats{
		DatabaseSizeBytes: duck.databaseSize,
		WALSizeBytes:      duck.walSize,
		TotalBlocks:       duck.totalBlocks,
		UsedBlocks:        duck.usedBlocks,
		FreeBlocks:        duck.freeBlocks,
		MemoryUsageBytes:  duck.memoryUsage,
		TempStorageBytes:  duck.tempUsage,

		FileBacked:    db.FileBacked,
		FileSizeBytes: db.FileSizeBytes,

		Tables: []TableRowCount{
			{Name: "resources", Rows: db.Resources},
			{Name: "metric_series", Rows: db.MetricSeries},
			{Name: "spans", Rows: db.Spans},
			{Name: "metric_points", Rows: db.MetricPoints},
			{Name: "logs", Rows: db.Logs},
		},

		OldestTimestamp: oldest,
		NewestTimestamp: newest,
		HasData:         hasData,
	}, nil
}
