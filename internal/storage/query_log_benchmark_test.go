package storage

import (
	"context"
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

// Run with -benchtime=30x for latency percentiles. Fixture creation is excluded.
// OTELOP_BENCH_LOG_ROWS=100000,1000000,10000000 selects larger workloads.
func BenchmarkLogsPageSearch(b *testing.B) {
	sizes := []int{100_000, 1_000_000}
	if raw := os.Getenv("OTELOP_BENCH_LOG_ROWS"); raw != "" {
		sizes = nil
		for _, part := range strings.Split(raw, ",") {
			n, err := strconv.Atoi(part)
			if err != nil || n < 100 {
				b.Fatalf("invalid OTELOP_BENCH_LOG_ROWS: %q", raw)
			}
			sizes = append(sizes, n)
		}
	}
	for _, n := range sizes {
		b.Run(fmt.Sprintf("rows_%d", n), func(b *testing.B) {
			s, from, to := benchmarkLogSearchStorage(b, n)
			cases := []struct {
				name, query string
				want        int
			}{
				{"browse", "", 100},
				{"body_error", "status=500", min((n+99)/100, 100)},
				{"attribute_error", "attributes.http.status_code:500", min((n+99)/100, 100)},
				{"attribute_and", "attributes.http.status_code:500 AND attributes.http.method:GET AND resource.deployment.environment.name:production", min((n+99)/100, 100)},
				{"resource", "resource.service.name:service-00", min((n+99)/100, 100)},
				{"wildcard", "attributes.url.path:/api/orders/*", 100},
				{"unique_old", "attributes.request.id:req-000000000042", 1},
				{"attribute_nohit", "attributes.request.id:*not-present*", 0},
				{"body_nohit", "not-present", 0},
				{"json_attribute", "handleOrder", 100},
				{"json_resource", "production", 100},
				{"exists", "attributes.error.type:*", min((n+99)/100, 100)},
			}
			for _, tc := range cases {
				b.Run(tc.name, func(b *testing.B) {
					ctx := context.Background()
					run := func() {
						items, more, err := s.LogsPage(ctx, from, to, nil, 100, tc.query)
						if err != nil {
							b.Fatal(err)
						}
						if len(items) != tc.want {
							b.Fatalf("got %d rows, want %d", len(items), tc.want)
						}
						if tc.want < 100 && more {
							b.Fatal("unexpected next page")
						}
					}
					if dir := os.Getenv("OTELOP_BENCH_LOG_EXPLAIN_DIR"); dir != "" {
						predicate, args := logSearchSQL(tc.query)
						args = append([]any{duckdb.Typed(from, duckdb.TYPE_TIMESTAMP_NS), duckdb.Typed(to, duckdb.TYPE_TIMESTAMP_NS)}, args...)
						first, cursorTS, cursorID := logCursorArgs(nil)
						args = append(args, first, duckdb.Typed(cursorTS, duckdb.TYPE_TIMESTAMP_NS), duckdb.Typed(cursorTS, duckdb.TYPE_TIMESTAMP_NS), cursorID, 101)
						var label, plan string
						if err := s.DB().QueryRowContext(ctx, "EXPLAIN ANALYZE "+fmt.Sprintf(logsPageQuery, predicate), args...).Scan(&label, &plan); err != nil {
							b.Fatal(err)
						}
						if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("rows_%d_%s.txt", n, tc.name)), []byte(plan), 0600); err != nil {
							b.Fatal(err)
						}
					}
					run()
					samples := make([]float64, 0, b.N)
					b.ResetTimer()
					for range b.N {
						start := time.Now()
						run()
						samples = append(samples, float64(time.Since(start))/float64(time.Millisecond))
					}
					b.StopTimer()
					slices.Sort(samples)
					b.ReportMetric(samples[len(samples)/2], "p50-ms")
					b.ReportMetric(samples[(len(samples)*95+99)/100-1], "p95-ms")
				})
			}
		})
	}
}

func benchmarkLogSearchStorage(b *testing.B, n int) (*Storage, time.Time, time.Time) {
	b.Helper()
	ctx := context.Background()
	path := filepath.Join(b.TempDir(), "logs.duckdb")
	opts := Options{Path: path, Retention: 30 * 24 * time.Hour, MaxSize: 16 << 30}
	s, err := Open(ctx, opts)
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() {
		if s != nil {
			_ = s.Close()
		}
	})
	from := time.Now().UTC().Add(-7 * 24 * time.Hour).Truncate(time.Second)
	to := from.Add(7 * 24 * time.Hour)
	_, err = s.writer.ExecContext(ctx, `INSERT INTO resources (resource_hash, service_name, attributes, schema_url, dropped_attributes_count, attributes_raw)
 SELECT i, printf('service-%02d',i), json_object(
 'service.name',printf('service-%02d',i),
 'deployment.environment.name', CASE WHEN i%2=0 THEN 'production' ELSE 'staging' END,
 'host.name',printf('host-%02d',i), 'service.version','1.2.3'), '', 0, ''::BLOB
 FROM range(100) t(i)`)
	if err != nil {
		b.Fatal(err)
	}
	// High-cardinality IDs and 20 attributes prevent an unrealistically tiny,
	// dictionary-compressed JSON fixture. Rows arrive in timestamp order.
	_, err = s.writer.ExecContext(ctx, `INSERT INTO logs (id,ts,observed_ts,trace_id,span_id,severity_number,severity_text,body,attributes,resource_hash,ingested_at)
 SELECT uuid(), make_timestamp_ns(? + i * ?), make_timestamp_ns(? + i * ?),
 md5((i//10)::VARCHAR), substr(md5(i::VARCHAR),1,16),
 CASE WHEN i%100=0 THEN 17 ELSE 9 END,
 CASE WHEN i%100=0 THEN 'ERROR' ELSE 'INFO' END,
 printf('HTTP request completed status=%d request=req-%012d path=/api/orders/%d duration=%dms ',
 CASE WHEN i%100=0 THEN 500 ELSE 200 END,i,i%10000,i%500) || repeat('request context ',8),
 json_merge_patch(json_object(
 'http.method', CASE WHEN i%5=0 THEN 'GET' ELSE 'POST' END,
 'http.status_code', CASE WHEN i%100=0 THEN 500 ELSE 200 END,
 'url.path',printf('/api/orders/%d',i%10000),
 'request.id',printf('req-%012d',i), 'user.id',printf('user-%d',i%50000),
 'session.id',md5((i//20)::VARCHAR), 'duration_ms',i%500, 'retry',i%7=0,
 'tenant.id',printf('tenant-%d',i%200),'client.address',printf('10.0.%d.%d',i%256,(i//256)%256),
 'network.protocol.version','1.1','server.port',8080,'server.address','api.example.test',
 'url.scheme','https','user_agent.original','otelop-benchmark-client/1.0',
 'code.function.name','handleOrder','code.file.path','src/handlers/orders.go',
 'code.line.number',100+i%100,'app.region','ap-northeast-1','app.build','20260914'),
 CASE WHEN i%100=0 THEN '{"error.type":"InternalError"}'::JSON ELSE '{}'::JSON END),
 i%100, make_timestamp_ns(? + i * ?)
 FROM range(?) t(i)`, from.UnixNano(), int64(to.Sub(from))/int64(n), from.UnixNano(), int64(to.Sub(from))/int64(n), from.UnixNano(), int64(to.Sub(from))/int64(n), n)
	if err != nil {
		b.Fatal(err)
	}
	if _, err = s.writer.ExecContext(ctx, "CHECKPOINT"); err != nil {
		b.Fatal(err)
	}
	var avgAttrs, avgBody float64
	if err = s.DB().QueryRowContext(ctx, `SELECT avg(octet_length(encode(attributes::VARCHAR))),avg(octet_length(encode(body))) FROM logs`).Scan(&avgAttrs, &avgBody); err != nil {
		b.Fatal(err)
	}
	var version string
	var threads int
	if err = s.DB().QueryRowContext(ctx, `SELECT version(), current_setting('threads')`).Scan(&version, &threads); err != nil {
		b.Fatal(err)
	}
	if err = s.Close(); err != nil {
		b.Fatal(err)
	}
	s = nil
	info, err := os.Stat(path)
	if err != nil {
		b.Fatal(err)
	}
	b.Logf("rows=%d db_bytes=%d avg_attribute_bytes=%.0f avg_body_bytes=%.0f duckdb=%s threads=%d", n, info.Size(), avgAttrs, avgBody, version, threads)
	s, err = Open(ctx, opts)
	if err != nil {
		b.Fatal(err)
	}
	return s, from, to
}
