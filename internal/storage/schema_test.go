package storage

import (
	"context"
	"database/sql"
	"testing"

	duckdb "github.com/duckdb/duckdb-go/v2"
)

// openTestDB opens an in-memory DuckDB database via database/sql, without
// any of Storage's writer/queue machinery — schema_test.go only needs to
// exercise migrate() directly.
func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	connector, err := duckdb.NewConnector("", nil)
	if err != nil {
		t.Fatalf("NewConnector: %v", err)
	}
	db := sql.OpenDB(connector)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestMigrate_CreatesAllTablesAndIndexes(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	if err := migrate(ctx, db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	tables := []string{"resources", "metric_series", "histogram_layouts", "metric_exemplars", "spans", "trace_summaries", "metric_points", "logs", "dropped_traces", "schema_meta"}
	for _, table := range tables {
		var name string
		err := db.QueryRowContext(ctx, `SELECT table_name FROM information_schema.tables WHERE table_name = ?`, table).Scan(&name)
		if err != nil {
			t.Errorf("table %q not found: %v", table, err)
		}
	}

	var version int
	if err := db.QueryRowContext(ctx, `SELECT version FROM schema_meta`).Scan(&version); err != nil {
		t.Fatalf("select schema_meta.version: %v", err)
	}
	if version != currentSchemaVersion {
		t.Errorf("schema_meta.version = %d, want %d", version, currentSchemaVersion)
	}

	indexes := []string{"idx_spans_trace", "idx_logs_trace", "idx_metric_exemplars_point"}
	for _, idx := range indexes {
		var name string
		err := db.QueryRowContext(ctx, `SELECT index_name FROM duckdb_indexes() WHERE index_name = ?`, idx).Scan(&name)
		if err != nil {
			t.Errorf("index %q not found: %v", idx, err)
		}
	}

	wantTypes := map[string]string{
		"value_int":    "BIGINT",
		"value_double": "DOUBLE",
		"count":        "UBIGINT",
		"flags":        "UINTEGER",
	}
	for column, want := range wantTypes {
		got, err := columnDataType(ctx, db, "metric_points", column)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("metric_points.%s type = %q, want %q", column, got, want)
		}
	}
}

func TestMigrate_IdempotentOnReopen(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()

	if err := migrate(ctx, db); err != nil {
		t.Fatalf("first migrate: %v", err)
	}
	// A second call against an already-migrated database must not attempt
	// to re-run schemaV1's CREATE TABLE statements (which would fail against
	// tables that already exist) and must leave schema_meta untouched.
	if err := migrate(ctx, db); err != nil {
		t.Fatalf("second migrate (should be a no-op): %v", err)
	}

	var count int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM schema_meta`).Scan(&count); err != nil {
		t.Fatalf("count schema_meta rows: %v", err)
	}
	if count != 1 {
		t.Errorf("schema_meta has %d rows after two migrate() calls, want exactly 1", count)
	}
}

func TestMigrate_ExtendsExistingSchemaV1WithoutVersionBump(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	_, err := db.ExecContext(ctx, `
		CREATE TABLE schema_meta (version INTEGER NOT NULL);
		INSERT INTO schema_meta VALUES (1);
		CREATE TABLE resources (resource_hash UBIGINT PRIMARY KEY, service_name VARCHAR NOT NULL, attributes JSON NOT NULL);
		CREATE TABLE metric_series (series_key UBIGINT PRIMARY KEY);
		CREATE TABLE metric_points (
			id UUID NOT NULL, series_key UBIGINT NOT NULL, ts TIMESTAMP_NS NOT NULL,
			start_ts TIMESTAMP_NS, value DOUBLE, count DOUBLE, sum DOUBLE, min DOUBLE, max DOUBLE,
			point_key BLOB, payload_hash BLOB
		);
		CREATE INDEX idx_metric_points_key ON metric_points (point_key);
		INSERT INTO metric_points (id, series_key, ts, value, count)
		VALUES (uuid(), 1, now(), 42.5, 9007199254740992);
	`)
	if err != nil {
		t.Fatal(err)
	}
	if err := migrate(ctx, db); err != nil {
		t.Fatalf("migrate existing v1: %v", err)
	}
	var columns int
	if err := db.QueryRowContext(ctx, `
		SELECT count(*) FROM information_schema.columns
		WHERE table_name = 'metric_points'
		  AND column_name IN ('ingested_at', 'flags', 'value_int', 'value_double',
			'histogram_layout_hash', 'bucket_counts', 'zero_count', 'positive_offset', 'positive_bucket_counts',
			'negative_offset', 'negative_bucket_counts', 'summary_quantiles', 'summary_quantile_values')
	`).Scan(&columns); err != nil {
		t.Fatal(err)
	}
	if columns != 13 {
		t.Fatalf("extended metric columns = %d, want 13", columns)
	}
	for _, column := range []string{"point_key", "payload_hash"} {
		exists, err := columnExists(ctx, db, "metric_points", column)
		if err != nil {
			t.Fatal(err)
		}
		if exists {
			t.Errorf("obsolete metric_points.%s still exists", column)
		}
	}
	var value float64
	var count uint64
	if err := db.QueryRowContext(ctx, `SELECT value_double, count FROM metric_points`).Scan(&value, &count); err != nil {
		t.Fatal(err)
	}
	if value != 42.5 || count != 9_007_199_254_740_992 {
		t.Fatalf("legacy value/count = %v/%d", value, count)
	}
	var version int
	if err := db.QueryRowContext(ctx, `SELECT version FROM schema_meta`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != 1 {
		t.Fatalf("schema version = %d, want unchanged v1", version)
	}
}

func TestMigrate_TimestampNsColumnsAcceptSubMicrosecondPrecision(t *testing.T) {
	// Sanity-checks the schema's TIMESTAMP_NS choice at the SQL level
	// (storage_test.go's TestStorage_TimestampNanosecondFidelity covers the
	// Appender path end-to-end).
	db := openTestDB(t)
	ctx := context.Background()
	if err := migrate(ctx, db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var isNS string
	err := db.QueryRowContext(ctx, `
		SELECT data_type FROM information_schema.columns
		WHERE table_name = 'spans' AND column_name = 'start_ts'
	`).Scan(&isNS)
	if err != nil {
		t.Fatalf("query column type: %v", err)
	}
	if isNS != "TIMESTAMP_NS" {
		t.Errorf("spans.start_ts data_type = %q, want TIMESTAMP_NS", isNS)
	}
}
