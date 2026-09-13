package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	duckdb "github.com/duckdb/duckdb-go/v2"
)

// The caller must provide a stopped database COPY. Open read-only and never
// print actual attribute values or log bodies into benchmark output.
func BenchmarkLogsPageSearchUserCopy(b *testing.B) {
	path := os.Getenv("OTELOP_BENCH_LOG_COPY")
	if path == "" {
		b.Skip("set OTELOP_BENCH_LOG_COPY to a database copy")
	}
	connector, err := duckdb.NewConnector(path+"?access_mode=read_only", nil)
	if err != nil {
		b.Fatal(err)
	}
	db := sql.OpenDB(connector)
	originalDB := db
	b.Cleanup(func() { _ = originalDB.Close() })
	if raw := os.Getenv("OTELOP_BENCH_LOG_COPY_ROWS"); raw != "" {
		target, err := strconv.Atoi(raw)
		if err != nil || target < 100 {
			b.Fatal("invalid OTELOP_BENCH_LOG_COPY_ROWS")
		}
		var original int
		if err := db.QueryRowContext(context.Background(), "SELECT count(*) FROM logs").Scan(&original); err != nil {
			b.Fatal(err)
		}
		if original == 0 {
			b.Fatal("no logs to scale")
		}
		scaledConnector, err := duckdb.NewConnector(filepath.Join(b.TempDir(), "scaled.duckdb"), nil)
		if err != nil {
			b.Fatal(err)
		}
		scaled := sql.OpenDB(scaledConnector)
		b.Cleanup(func() { _ = scaled.Close() })
		if _, err := scaled.ExecContext(context.Background(), "ATTACH '"+strings.ReplaceAll(path, "'", "''")+"' AS source (READ_ONLY)"); err != nil {
			b.Fatal(err)
		}
		if _, err := scaled.ExecContext(context.Background(), "CREATE TABLE resources AS SELECT * FROM source.resources"); err != nil {
			b.Fatal(err)
		}
		if _, err := scaled.ExecContext(context.Background(), `CREATE TABLE logs AS
          SELECT * REPLACE(uuid() AS id) FROM (
            SELECT l.* FROM source.logs l CROSS JOIN range(?) r LIMIT ?
          ) ORDER BY ts`, (target+original-1)/original, target); err != nil {
			b.Fatal(err)
		}
		if _, err := scaled.ExecContext(context.Background(), "CREATE INDEX idx_logs_trace ON logs(trace_id); CHECKPOINT; DETACH source"); err != nil {
			b.Fatal(err)
		}
		db = scaled
	}
	s := &Storage{db: db}
	ctx := context.Background()
	var n, resources int
	var from, to time.Time
	var avgAttrs, avgBody float64
	if err := db.QueryRowContext(ctx, `SELECT count(*),min(ts),max(ts),avg(octet_length(encode(attributes::VARCHAR))),avg(octet_length(encode(body))),count(DISTINCT resource_hash) FROM logs`).Scan(&n, &from, &to, &avgAttrs, &avgBody, &resources); err != nil {
		b.Fatal(err)
	}
	to = to.Add(time.Nanosecond)
	var version string
	var threads int
	if err := db.QueryRowContext(ctx, `SELECT version(), current_setting('threads')`).Scan(&version, &threads); err != nil {
		b.Fatal(err)
	}
	b.Logf("rows=%d resources=%d avg_attribute_bytes=%.0f avg_body_bytes=%.0f span_hours=%.1f duckdb=%s threads=%d", n, resources, avgAttrs, avgBody, to.Sub(from).Hours(), version, threads)
	type benchCase struct{ name, query string }
	cases := []benchCase{{"browse", ""}, {"body_nohit", "otelop-benchmark-no-such-value-8a6c4f"}}
	// Select the most frequently present scalar keys, then common and rare values.
	rows, err := db.QueryContext(ctx, `SELECT j.key,count(*) AS n FROM logs l,json_each(l.attributes) j WHERE j.type IN ('VARCHAR','BIGINT','UBIGINT','BOOLEAN','DOUBLE') GROUP BY j.key ORDER BY n DESC,j.key LIMIT 3`)
	if err != nil {
		b.Fatal(err)
	}
	var keys []string
	for rows.Next() {
		var key string
		var count int
		if err := rows.Scan(&key, &count); err != nil {
			b.Fatal(err)
		}
		keys = append(keys, key)
		b.Logf("attribute_%d coverage=%d", len(keys), count)
	}
	if err := rows.Err(); err != nil {
		b.Fatal(err)
	}
	_ = rows.Close()
	quote := func(v string) string { data, _ := json.Marshal(v); return string(data) }
	for i, key := range keys {
		var common, rare string
		var count int
		if err := db.QueryRowContext(ctx, `SELECT json_extract_string(j.value,'$'),count(*) AS n FROM logs l,json_each(l.attributes) j WHERE j.key=? AND j.type IN ('VARCHAR','BIGINT','UBIGINT','BOOLEAN','DOUBLE') GROUP BY j.value ORDER BY n DESC,j.value LIMIT 1`, key).Scan(&common, &count); err != nil {
			b.Fatal(err)
		}
		b.Logf("attribute_%d common_matches=%d", i+1, count)
		if err := db.QueryRowContext(ctx, `SELECT json_extract_string(j.value,'$'),count(*) AS n FROM logs l,json_each(l.attributes) j WHERE j.key=? AND j.type IN ('VARCHAR','BIGINT','UBIGINT','BOOLEAN','DOUBLE') GROUP BY j.value ORDER BY n,j.value LIMIT 1`, key).Scan(&rare, &count); err != nil {
			b.Fatal(err)
		}
		b.Logf("attribute_%d rare_matches=%d", i+1, count)
		prefix := "attributes." + key + ":"
		cases = append(cases, benchCase{fmt.Sprintf("attribute_%d_common", i+1), prefix + quote(common)}, benchCase{fmt.Sprintf("attribute_%d_rare", i+1), prefix + quote(rare)}, benchCase{fmt.Sprintf("attribute_%d_nohit", i+1), prefix + "*otelop-benchmark-no-such-value-8a6c4f*"})
	}
	if len(keys) >= 2 {
		cases = append(cases, benchCase{"attribute_and", cases[2].query + " AND " + cases[5].query})
	}
	for _, tc := range cases {
		b.Run(tc.name, func(b *testing.B) {
			items, _, err := s.LogsPage(ctx, from, to, nil, 100, tc.query)
			if err != nil {
				b.Fatal(err)
			}
			want := len(items)
			if strings.Contains(tc.name, "nohit") && want != 0 {
				b.Fatal("no-hit query unexpectedly matched")
			}
			if (strings.HasSuffix(tc.name, "common") || strings.HasSuffix(tc.name, "rare")) && want == 0 {
				b.Fatal("attribute query failed to match the selected value")
			}
			samples := make([]float64, 0, b.N)
			b.ResetTimer()
			for range b.N {
				start := time.Now()
				items, _, err = s.LogsPage(ctx, from, to, nil, 100, tc.query)
				if err != nil {
					b.Fatal(err)
				}
				if len(items) != want {
					b.Fatal("unstable result count")
				}
				samples = append(samples, float64(time.Since(start))/float64(time.Millisecond))
			}
			b.StopTimer()
			slices.Sort(samples)
			b.ReportMetric(samples[len(samples)/2], "p50-ms")
			b.ReportMetric(samples[(len(samples)*95+99)/100-1], "p95-ms")
			b.ReportMetric(float64(want), "rows/page")
		})
	}
}
