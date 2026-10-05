package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/pmetric"
)

func TestStorage_Sweep_RepeatedSeriesUnderMemoryLimit(t *testing.T) {
	s := openTestStorage(t, Options{Path: filepath.Join(t.TempDir(), "sweep.duckdb"), Retention: time.Hour})
	ctx := context.Background()
	for _, age := range []time.Duration{0, 2 * time.Hour} {
		md := pmetric.NewMetrics()
		rm := md.ResourceMetrics().AppendEmpty()
		rm.Resource().Attributes().PutStr("service.name", age.String())
		metric := rm.ScopeMetrics().AppendEmpty().Metrics().AppendEmpty()
		metric.SetName("repeated.metric")
		point := metric.SetEmptyGauge().DataPoints().AppendEmpty()
		point.SetDoubleValue(1)
		point.SetTimestamp(pcommon.NewTimestampFromTime(time.Now().Add(-age)))
		s.AddMetrics(ctx, md)
	}
	s.Sync()
	// A small number of series can accumulate many points between sweeps.
	for _, query := range []string{
		`INSERT INTO metric_points SELECT p.* REPLACE (uuid() AS id) FROM metric_points p, range(1000000) WHERE p.ts = (SELECT max(ts) FROM metric_points)`,
		`CHECKPOINT`,
		`SET threads = 2`,
		`SET memory_limit = '16MB'`,
	} {
		if _, err := s.DB().ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Sweep(ctx); err != nil {
		t.Fatalf("sweep repeated series under memory limit: %v", err)
	}
	var serviceName string
	if err := s.DB().QueryRowContext(ctx, `SELECT service_name FROM metric_series`).Scan(&serviceName); err != nil {
		t.Fatal(err)
	}
	if serviceName != "0s" {
		t.Fatalf("retained series service = %q, want 0s", serviceName)
	}
	for table, want := range map[string]int{"metric_points": 1000001, "metric_series": 1, "resources": 1} {
		var got int
		if err := s.DB().QueryRowContext(ctx, `SELECT count(*) FROM `+table).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("%s rows = %d, want %d", table, got, want)
		}
	}
}
