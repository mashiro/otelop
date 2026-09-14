package storage

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

// Synthetic, time-distributed spans; no idle user database is used. Ten spans
// per trace, twenty attributes, unique request IDs. Fixture creation is untimed.
func BenchmarkTraceSearch(b *testing.B) {
	for _, n := range []int{100_000, 1_000_000} {
		b.Run(fmt.Sprintf("spans_%d", n), func(b *testing.B) {
			ctx := context.Background()
			s, err := Open(ctx, Options{Path: filepath.Join(b.TempDir(), "traces.duckdb"), Retention: 30 * 24 * time.Hour, MaxSize: 16 << 30})
			if err != nil {
				b.Fatal(err)
			}
			b.Cleanup(func() { _ = s.Close() })
			from := time.Now().UTC().Add(-7 * 24 * time.Hour).Truncate(time.Second)
			to := from.Add(7 * 24 * time.Hour)
			if _, err = s.writer.ExecContext(ctx, `INSERT INTO resources VALUES (1,'api','',0,'{"service.name":"api","deployment.environment.name":"production"}',''::BLOB)`); err != nil {
				b.Fatal(err)
			}
			_, err = s.writer.ExecContext(ctx, `INSERT INTO spans SELECT printf('%032x',i//10),printf('%016x',i),CASE WHEN i%10=0 THEN '' ELSE printf('%016x',(i//10)*10) END,
    CASE WHEN i%10=0 THEN 'request' ELSE 'db.query' END,'Server',make_timestamp_ns(?+i*?),make_timestamp_ns(?+i*?+1000000),
    CASE WHEN i%100=0 THEN 'Error' ELSE 'Ok' END,'',
    json_object('http.status_code',CASE WHEN i%100=0 THEN 500 ELSE 200 END,'http.method','GET','request.id',printf('req-%012d',i),'arguments',json_object('cmd','git diff --check'),
    'url.path','/api/orders','code.function','handleOrder','code.file','orders.go','code.line',42,'server.address','localhost','server.port',8080,
    'network.protocol','http','network.version','1.1','db.system','postgresql','db.name','orders','db.operation','SELECT','user.id',printf('user-%d',i%10000),
    'session.id',printf('session-%d',i%100000),'retry',false,'bytes',i%65536,'duration',i%1000),
    '[]',1,make_timestamp_ns(?+i*?) FROM range(?) rows(i)`, from.UnixNano(), int64(7*24*time.Hour)/int64(n), from.UnixNano(), int64(7*24*time.Hour)/int64(n), from.UnixNano(), int64(7*24*time.Hour)/int64(n), n)
			if err != nil {
				b.Fatal(err)
			}
			if err = s.rebuildAllTraceSummaries(ctx); err != nil {
				b.Fatal(err)
			}
			if _, err = s.writer.ExecContext(ctx, "CHECKPOINT"); err != nil {
				b.Fatal(err)
			}
			if stats, err := s.DBStats(ctx); err == nil {
				b.Logf("spans=%d traces=%d db=%.1f MiB", n, n/10, float64(stats.FileSizeBytes)/(1<<20))
			}
			for _, tc := range []struct {
				name, query string
				want        int
			}{
				{"browse", "", 100}, {"name", "db.query", 100}, {"json", "diff", 100},
				{"attributes", `attributes.http.status_code:>=500 resource.service.name:"api"`, 100},
				{"unique", `attributes.request.id:"req-000000000042"`, 1}, {"nohit", "not-present", 0},
			} {
				b.Run(tc.name, func(b *testing.B) {
					run := func() {
						items, _, err := s.TracesPage(ctx, from, to, nil, 100, tc.query)
						if err != nil {
							b.Fatal(err)
						}
						if len(items) != tc.want {
							b.Fatalf("got %d want %d", len(items), tc.want)
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
			for _, tc := range []struct{ name, key, input string }{
				{"suggest_keys", "", ""}, {"suggest_values", "attributes.request.id", ""}, {"suggest_filtered", "attributes.request.id", "000000000042"},
			} {
				b.Run(tc.name, func(b *testing.B) {
					for range b.N {
						_, err := s.FilterSuggestions(ctx, "traces", tc.key, tc.input, from, to)
						if err != nil {
							b.Fatal(err)
						}
					}
				})
			}

			b.Run("live_100_ids", func(b *testing.B) {
				ids := make([]string, 100)
				for i := range ids {
					ids[i] = fmt.Sprintf("%032x", i)
				}
				b.ResetTimer()
				for range b.N {
					_, err := s.MatchingTraceIDs(ctx, ids, from, to, `attributes.http.status_code:>=500`)
					if err != nil {
						b.Fatal(err)
					}
				}
			})
		})
	}
}
