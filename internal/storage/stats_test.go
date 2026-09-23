package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestStorage_Stats_FileBacked(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "otelop.duckdb")
	s := openTestStorage(t, Options{Path: path})

	now := time.Now()
	td := buildTraces([16]byte{60}, [16]byte{}, [8]byte{1}, "op", now)
	s.AddTraces(context.Background(), td)
	s.Sync()
	// DuckDB doesn't allocate storage blocks until checkpointed.
	if err := s.Sweep(context.Background()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}

	stats, err := s.Stats(context.Background())
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if !stats.FileBacked {
		t.Errorf("FileBacked = false, want true")
	}
	if stats.FileSizeBytes <= 0 {
		t.Errorf("FileSizeBytes = %d, want > 0", stats.FileSizeBytes)
	}
	if stats.TotalBlocks <= 0 {
		t.Errorf("TotalBlocks = %d, want > 0", stats.TotalBlocks)
	}
	if !stats.HasData {
		t.Errorf("HasData = false, want true")
	}
	if stats.OldestTimestamp.IsZero() || stats.NewestTimestamp.IsZero() {
		t.Errorf("Oldest/Newest timestamps zero, want set (Oldest=%v, Newest=%v)", stats.OldestTimestamp, stats.NewestTimestamp)
	}

	var spansRows int64 = -1
	for _, tr := range stats.Tables {
		if tr.Name == "spans" {
			spansRows = tr.Rows
		}
	}
	if spansRows != 1 {
		t.Errorf("spans rows = %d, want 1", spansRows)
	}
}

func TestStorage_Stats_NoData(t *testing.T) {
	s := openTestStorage(t, Options{})
	stats, err := s.Stats(context.Background())
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if stats.HasData {
		t.Errorf("HasData = true, want false (nothing ingested)")
	}
	if stats.FileBacked {
		t.Errorf("FileBacked = true, want false (in-memory DB)")
	}
}
