package storage

import "time"

// SweepResult records the outcome of one retention/max_size sweep pass.
type SweepResult struct {
	StartedAt time.Time
	Duration  time.Duration
	// DeletedRows includes rows removed by enforceMaxSize's day-trim
	// iterations, not just the retention cutoff pass.
	DeletedRows       int64
	MaxSizeIterations int
	// Error is the sweep's error message, or empty on success.
	Error string
}

// LastSweep is safe to call from any goroutine: performSweep runs on the
// writer goroutine, but publishes through an atomic pointer so readers
// never block on it.
func (s *Storage) LastSweep() (SweepResult, bool) {
	p := s.lastSweep.Load()
	if p == nil {
		return SweepResult{}, false
	}
	return *p, true
}

func (s *Storage) SweepInterval() time.Duration { return sweepInterval }

// NextSweepAt is derived from when the sweep ticker started, since it fires
// every SweepInterval from that instant regardless of any manual Sweep
// calls in between.
func (s *Storage) NextSweepAt() (time.Time, bool) {
	if s.sweepTickerStartedAt.IsZero() {
		return time.Time{}, false
	}
	elapsed := time.Since(s.sweepTickerStartedAt)
	n := elapsed/sweepInterval + 1
	return s.sweepTickerStartedAt.Add(sweepInterval * n), true
}
