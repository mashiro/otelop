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

	tables := []string{"resources", "metric_series", "spans", "trace_summaries", "metric_points", "logs", "dropped_traces", "schema_meta"}
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

	indexes := []string{"idx_spans_trace", "idx_logs_trace"}
	for _, idx := range indexes {
		var name string
		err := db.QueryRowContext(ctx, `SELECT index_name FROM duckdb_indexes() WHERE index_name = ?`, idx).Scan(&name)
		if err != nil {
			t.Errorf("index %q not found: %v", idx, err)
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
