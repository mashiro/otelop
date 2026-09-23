package storage

import (
	"context"
	"testing"
	"time"
)

func TestStorage_LastSweep_BeforeAnySweep(t *testing.T) {
	s := openTestStorage(t, Options{})
	if _, ok := s.LastSweep(); ok {
		t.Fatalf("LastSweep before any sweep: ok = true, want false")
	}
}

func TestStorage_LastSweep_AfterSweep(t *testing.T) {
	s := openTestStorage(t, Options{Retention: time.Hour})

	old := time.Now().Add(-2 * time.Hour)
	td := buildTraces([16]byte{50}, [16]byte{}, [8]byte{1}, "old-span", old)
	s.AddTraces(context.Background(), td)
	s.Sync()

	if err := s.Sweep(context.Background()); err != nil {
		t.Fatalf("Sweep: %v", err)
	}

	result, ok := s.LastSweep()
	if !ok {
		t.Fatalf("LastSweep after Sweep: ok = false, want true")
	}
	if result.Error != "" {
		t.Errorf("Error = %q, want empty", result.Error)
	}
	if result.DeletedRows < 1 {
		t.Errorf("DeletedRows = %d, want >= 1 (the expired span)", result.DeletedRows)
	}
	if result.Duration <= 0 {
		t.Errorf("Duration = %v, want > 0", result.Duration)
	}
	if result.StartedAt.IsZero() {
		t.Errorf("StartedAt is zero, want set")
	}
	if result.MaxSizeIterations != 0 {
		t.Errorf("MaxSizeIterations = %d, want 0 (in-memory DB skips max-size enforcement)", result.MaxSizeIterations)
	}
}

func TestStorage_SweepInterval(t *testing.T) {
	s := openTestStorage(t, Options{})
	if got := s.SweepInterval(); got != time.Hour {
		t.Errorf("SweepInterval() = %v, want 1h", got)
	}
}

func TestStorage_NextSweepAt(t *testing.T) {
	s := openTestStorage(t, Options{})
	next, ok := s.NextSweepAt()
	if !ok {
		t.Fatalf("NextSweepAt: ok = false, want true")
	}
	now := time.Now()
	if !next.After(now) {
		t.Errorf("NextSweepAt = %v, want after now (%v)", next, now)
	}
	if next.After(now.Add(s.SweepInterval() + time.Second)) {
		t.Errorf("NextSweepAt = %v, want within one sweep interval of now", next)
	}
}
