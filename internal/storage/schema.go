package storage

import (
	"context"
	"database/sql"
	"fmt"
)

// currentSchemaVersion is the schema version this build knows how to reach.
// migrate applies every step between the database's recorded version (0 for
// a brand-new database) and this value.
const currentSchemaVersion = 1

// schemaV1 is the exact DDL from docs/design/duckdb-storage.md. TIMESTAMP_NS
// (not the default microsecond TIMESTAMP) everywhere OTel emits nanosecond
// precision, confirmed to round-trip losslessly through the Go driver's
// Appender in storage_test.go's TestStorage_TimestampNanosecondFidelity.
const schemaV1 = `
CREATE TABLE resources (
  resource_hash UBIGINT PRIMARY KEY,
  service_name  VARCHAR NOT NULL,
  attributes    JSON NOT NULL
);

CREATE TABLE metric_series (
  series_key    UBIGINT PRIMARY KEY,
  service_name  VARCHAR NOT NULL,
  metric_name   VARCHAR NOT NULL,
  metric_type   VARCHAR NOT NULL,
  unit          VARCHAR,
  description   VARCHAR,
  temporality   VARCHAR,
  is_monotonic  BOOLEAN,
  attributes    JSON NOT NULL,
  scope_name       VARCHAR NOT NULL,
  scope_version    VARCHAR NOT NULL,
  scope_schema_url VARCHAR NOT NULL,
  scope_attributes JSON NOT NULL,
  resource_hash UBIGINT NOT NULL,
  first_seen    TIMESTAMP_NS NOT NULL,
  last_seen     TIMESTAMP_NS NOT NULL
);

CREATE TABLE spans (
  trace_id       VARCHAR NOT NULL,
  span_id        VARCHAR NOT NULL,
  parent_span_id VARCHAR,
  name           VARCHAR NOT NULL,
  kind           VARCHAR,
  start_ts       TIMESTAMP_NS NOT NULL,
  end_ts         TIMESTAMP_NS NOT NULL,
  status_code    VARCHAR,
  status_message VARCHAR,
  attributes     JSON,
  events         JSON,
  resource_hash  UBIGINT NOT NULL,
  ingested_at    TIMESTAMP_NS NOT NULL
);
CREATE INDEX idx_spans_trace ON spans (trace_id);

CREATE TABLE metric_points (
  id         UUID NOT NULL,
  series_key UBIGINT NOT NULL,
  ts         TIMESTAMP_NS NOT NULL,
  start_ts   TIMESTAMP_NS,
  value      DOUBLE,
  count      DOUBLE,
  sum        DOUBLE,
  min        DOUBLE,
  max        DOUBLE
);

CREATE TABLE logs (
  id              UUID NOT NULL,
  ts              TIMESTAMP_NS NOT NULL,
  observed_ts     TIMESTAMP_NS,
  trace_id        VARCHAR,
  span_id         VARCHAR,
  severity_number INTEGER,
  severity_text   VARCHAR,
  body            VARCHAR,
  attributes      JSON,
  resource_hash   UBIGINT NOT NULL,
  ingested_at     TIMESTAMP_NS NOT NULL
);
CREATE INDEX idx_logs_trace ON logs (trace_id);

CREATE TABLE schema_meta (version INTEGER NOT NULL);
`

// migrationStep is one schema version's forward migration. Later versions
// append to this list rather than editing schemaV1 in place, so applying
// migrations to an existing database only ever runs the steps it hasn't
// seen yet.
type migrationStep struct {
	version int
	ddl     string
}

var migrations = []migrationStep{
	{version: 1, ddl: schemaV1},
}

// migrate brings db up to currentSchemaVersion. It is safe to call on every
// Open: a database that already recorded the latest version in schema_meta
// runs no DDL at all, so re-opening an existing database file is a no-op
// (verified by TestMigrate_Idempotent).
func migrate(ctx context.Context, db *sql.DB) error {
	version, err := schemaVersion(ctx, db)
	if err != nil {
		return fmt.Errorf("storage: read schema version: %w", err)
	}

	for _, m := range migrations {
		if m.version <= version {
			continue
		}
		if err := applyMigration(ctx, db, version, m); err != nil {
			return fmt.Errorf("storage: apply schema migration %d: %w", m.version, err)
		}
		version = m.version
	}
	return nil
}

// schemaVersion reads the recorded schema version, returning 0 for a
// brand-new database. A fresh DuckDB file has no schema_meta table yet, so
// the SELECT fails with a catalog error; rather than pattern-match DuckDB's
// error text we treat any failure here as "no schema yet" — a real
// connection problem surfaces immediately on the DDL that follows.
func schemaVersion(ctx context.Context, db *sql.DB) (int, error) {
	var version int
	if err := db.QueryRowContext(ctx, `SELECT version FROM schema_meta LIMIT 1`).Scan(&version); err != nil {
		return 0, nil //nolint:nilerr // any failure here means "no schema yet" (see doc comment); a real connection problem resurfaces on the DDL that follows
	}
	return version, nil
}

// applyMigration runs one migration step's DDL plus the schema_meta bookkeeping
// in a single transaction, so a failure partway through never leaves the
// database in a state where schema_meta disagrees with what tables exist.
func applyMigration(ctx context.Context, db *sql.DB, fromVersion int, step migrationStep) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }() // no-op once Commit succeeds

	if _, err := tx.ExecContext(ctx, step.ddl); err != nil {
		return err
	}

	if fromVersion == 0 {
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_meta (version) VALUES (?)`, step.version); err != nil {
			return err
		}
	} else {
		if _, err := tx.ExecContext(ctx, `UPDATE schema_meta SET version = ?`, step.version); err != nil {
			return err
		}
	}
	return tx.Commit()
}
