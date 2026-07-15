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
  schema_url    VARCHAR NOT NULL,
  dropped_attributes_count UINTEGER NOT NULL,
  attributes    JSON NOT NULL,
  attributes_raw BLOB NOT NULL
);

CREATE TABLE metric_series (
  series_key    UBIGINT PRIMARY KEY,
  service_name  VARCHAR NOT NULL,
  metric_name   VARCHAR NOT NULL,
  metric_type   VARCHAR NOT NULL,
  number_kind   VARCHAR NOT NULL,
  unit          VARCHAR,
  description   VARCHAR,
  temporality   VARCHAR,
  is_monotonic  BOOLEAN,
  attributes    JSON NOT NULL,
  attributes_raw BLOB NOT NULL,
  scope_name       VARCHAR NOT NULL,
  scope_version    VARCHAR NOT NULL,
  scope_schema_url VARCHAR NOT NULL,
  scope_dropped_attributes_count UINTEGER NOT NULL,
  scope_attributes JSON NOT NULL,
  scope_attributes_raw BLOB NOT NULL,
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

CREATE TABLE trace_summaries (
  trace_id               VARCHAR PRIMARY KEY,
  start_ts               TIMESTAMP_NS NOT NULL,
  end_ts                 TIMESTAMP_NS NOT NULL,
  span_count             BIGINT NOT NULL,
  has_error              BOOLEAN NOT NULL,
  first_seen             TIMESTAMP_NS NOT NULL,
  root_span_id           VARCHAR,
  root_name              VARCHAR,
  root_kind              VARCHAR,
  root_status_code       VARCHAR,
  root_start_ts          TIMESTAMP_NS,
  root_end_ts            TIMESTAMP_NS,
  root_resource_hash     UBIGINT,
  earliest_span_id       VARCHAR NOT NULL,
  earliest_resource_hash UBIGINT NOT NULL
);

CREATE TABLE dropped_traces (
  trace_id   VARCHAR PRIMARY KEY,
  last_seen TIMESTAMP_NS NOT NULL,
  span_count BIGINT NOT NULL
);

CREATE TABLE metric_points (
  id          UUID NOT NULL,
  series_key  UBIGINT NOT NULL,
  ts          TIMESTAMP_NS NOT NULL,
  start_ts    TIMESTAMP_NS,
  ingested_at TIMESTAMP_NS NOT NULL,
  flags       UINTEGER NOT NULL,
  value_int   BIGINT,
  value_double DOUBLE,
  count       UBIGINT,
  sum         DOUBLE,
  min         DOUBLE,
  max         DOUBLE,
  histogram_layout_hash UBIGINT,
  bucket_counts UBIGINT[],
  zero_count UBIGINT,
  positive_offset INTEGER,
  positive_bucket_counts UBIGINT[],
  negative_offset INTEGER,
  negative_bucket_counts UBIGINT[],
  summary_quantiles DOUBLE[],
  summary_quantile_values DOUBLE[]
);

CREATE TABLE histogram_layouts (
  layout_hash    UBIGINT PRIMARY KEY,
  kind           VARCHAR NOT NULL,
  explicit_bounds DOUBLE[],
  scale          INTEGER,
  zero_threshold DOUBLE
);

CREATE TABLE metric_exemplars (
  id                  UUID NOT NULL,
  point_id            UUID NOT NULL,
  ts                  TIMESTAMP_NS NOT NULL,
  trace_id            VARCHAR,
  span_id             VARCHAR,
  filtered_attributes JSON NOT NULL,
  filtered_attributes_raw BLOB NOT NULL,
  value_int           BIGINT,
  value_double        DOUBLE
);
CREATE INDEX idx_metric_exemplars_point ON metric_exemplars (point_id);

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
	return ensureSchemaV1Extensions(ctx, db)
}

// ensureSchemaV1Extensions keeps development databases created earlier in
// schema v1 usable while that unreleased schema is still evolving. Once v1
// is released, subsequent changes must use a numbered migration instead.
func ensureSchemaV1Extensions(ctx context.Context, db *sql.DB) error {
	statements := []string{
		`ALTER TABLE resources ADD COLUMN IF NOT EXISTS schema_url VARCHAR DEFAULT ''`,
		`ALTER TABLE resources ADD COLUMN IF NOT EXISTS dropped_attributes_count UINTEGER DEFAULT 0`,
		`ALTER TABLE resources ADD COLUMN IF NOT EXISTS attributes_raw BLOB`,
		`ALTER TABLE metric_series ADD COLUMN IF NOT EXISTS number_kind VARCHAR DEFAULT ''`,
		`ALTER TABLE metric_series ADD COLUMN IF NOT EXISTS scope_dropped_attributes_count UINTEGER DEFAULT 0`,
		`ALTER TABLE metric_series ADD COLUMN IF NOT EXISTS attributes_raw BLOB`,
		`ALTER TABLE metric_series ADD COLUMN IF NOT EXISTS scope_attributes_raw BLOB`,
		`CREATE TABLE IF NOT EXISTS histogram_layouts (
			layout_hash UBIGINT PRIMARY KEY, kind VARCHAR NOT NULL,
			explicit_bounds DOUBLE[], scale INTEGER, zero_threshold DOUBLE)`,
		`CREATE TABLE IF NOT EXISTS metric_exemplars (
			id UUID NOT NULL, point_id UUID NOT NULL, ts TIMESTAMP_NS NOT NULL,
			trace_id VARCHAR, span_id VARCHAR, filtered_attributes JSON NOT NULL, filtered_attributes_raw BLOB,
			value_int BIGINT, value_double DOUBLE)`,
		`ALTER TABLE metric_exemplars ADD COLUMN IF NOT EXISTS filtered_attributes_raw BLOB`,
		`CREATE INDEX IF NOT EXISTS idx_metric_exemplars_point ON metric_exemplars (point_id)`,
		`ALTER TABLE metric_points ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMP_NS`,
		`ALTER TABLE metric_points ADD COLUMN IF NOT EXISTS flags UINTEGER DEFAULT 0`,
		`ALTER TABLE metric_points ADD COLUMN IF NOT EXISTS value_int BIGINT`,
		`ALTER TABLE metric_points ADD COLUMN IF NOT EXISTS value_double DOUBLE`,
		`ALTER TABLE metric_points ADD COLUMN IF NOT EXISTS histogram_layout_hash UBIGINT`,
		`ALTER TABLE metric_points ADD COLUMN IF NOT EXISTS bucket_counts UBIGINT[]`,
		`ALTER TABLE metric_points ADD COLUMN IF NOT EXISTS zero_count UBIGINT`,
		`ALTER TABLE metric_points ADD COLUMN IF NOT EXISTS positive_offset INTEGER`,
		`ALTER TABLE metric_points ADD COLUMN IF NOT EXISTS positive_bucket_counts UBIGINT[]`,
		`ALTER TABLE metric_points ADD COLUMN IF NOT EXISTS negative_offset INTEGER`,
		`ALTER TABLE metric_points ADD COLUMN IF NOT EXISTS negative_bucket_counts UBIGINT[]`,
		`ALTER TABLE metric_points ADD COLUMN IF NOT EXISTS summary_quantiles DOUBLE[]`,
		`ALTER TABLE metric_points ADD COLUMN IF NOT EXISTS summary_quantile_values DOUBLE[]`,
	}
	for _, statement := range statements {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("storage: extend schema v1: %w", err)
		}
	}
	// point_key/payload_hash were briefly added during pre-release schema-v1
	// development. Both are derivable from the retained interval and payload,
	// while their random 64 bytes per point do not compress. Remove them from
	// any development database that opened that intermediate build.
	if _, err := db.ExecContext(ctx, `DROP INDEX IF EXISTS idx_metric_points_key`); err != nil {
		return fmt.Errorf("storage: drop metric point hash index: %w", err)
	}
	for _, column := range []string{"point_key", "payload_hash"} {
		if _, err := db.ExecContext(ctx, `ALTER TABLE metric_points DROP COLUMN IF EXISTS `+column); err != nil {
			return fmt.Errorf("storage: drop metric_points.%s: %w", column, err)
		}
	}
	// Development databases created before exact numeric storage retained
	// scalar values in one DOUBLE column. Preserve those observations in the
	// new double arm; their original int/double discriminator was already
	// lost, so it cannot be reconstructed retroactively.
	hasLegacyValue, err := columnExists(ctx, db, "metric_points", "value")
	if err != nil {
		return err
	}
	if hasLegacyValue {
		if _, err := db.ExecContext(ctx, `UPDATE metric_points SET value_double = value WHERE value_double IS NULL`); err != nil {
			return fmt.Errorf("storage: preserve legacy metric values: %w", err)
		}
	}
	countType, err := columnDataType(ctx, db, "metric_points", "count")
	if err != nil {
		return err
	}
	if countType == "DOUBLE" {
		if _, err := db.ExecContext(ctx, `ALTER TABLE metric_points ALTER COLUMN count TYPE UBIGINT USING CAST(count AS UBIGINT)`); err != nil {
			return fmt.Errorf("storage: preserve metric counts as uint64: %w", err)
		}
	}
	return nil
}

func columnExists(ctx context.Context, db *sql.DB, table, column string) (bool, error) {
	var exists bool
	err := db.QueryRowContext(ctx, `
		SELECT count(*) > 0
		FROM information_schema.columns
		WHERE table_name = ? AND column_name = ?`, table, column).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("storage: inspect %s.%s: %w", table, column, err)
	}
	return exists, nil
}

func columnDataType(ctx context.Context, db *sql.DB, table, column string) (string, error) {
	var dataType string
	err := db.QueryRowContext(ctx, `
		SELECT data_type
		FROM information_schema.columns
		WHERE table_name = ? AND column_name = ?`, table, column).Scan(&dataType)
	if err != nil {
		return "", fmt.Errorf("storage: inspect type of %s.%s: %w", table, column, err)
	}
	return dataType, nil
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
