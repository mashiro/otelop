package storage

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func BenchmarkTraceSummaryIncrementalAtScale(b *testing.B) {
	for _, existingRows := range []int{0, 100_000, 500_000} {
		b.Run(fmt.Sprintf("existing_spans_%d", existingRows), func(b *testing.B) {
			ctx := context.Background()
			s := benchmarkStorageWithRows(b, existingRows)

			base := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				rows := make([]SpanRow, 32)
				traceID := fmt.Sprintf("bench-%027d", i)
				for j := range rows {
					rows[j] = SpanRow{
						TraceID: traceID, SpanID: fmt.Sprintf("%016d", j), Name: "bench",
						StartTS:      base.Add(time.Duration(j) * time.Microsecond),
						EndTS:        base.Add(time.Duration(j)*time.Microsecond + time.Millisecond),
						ResourceHash: 1,
					}
				}
				if _, _, _, err := s.writeTraceRowsTransaction(ctx, rows, base); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func BenchmarkTracesPageFromSummariesAtScale(b *testing.B) {
	s := benchmarkStorageWithRows(b, 500_000)
	ctx := context.Background()
	from := time.Date(2025, 12, 31, 0, 0, 0, 0, time.UTC)
	to := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, _, err := s.TracesPage(ctx, from, to, nil, 50, ""); err != nil {
			b.Fatal(err)
		}
	}
}

func benchmarkStorageWithRows(b *testing.B, existingRows int) *Storage {
	b.Helper()
	ctx := context.Background()
	s, err := Open(ctx, Options{})
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = s.Close() })
	if _, err := s.writer.ExecContext(ctx, `INSERT INTO resources VALUES (1, 'bench', '{}')`); err != nil {
		b.Fatal(err)
	}
	if existingRows == 0 {
		return s
	}
	_, err = s.writer.ExecContext(ctx, `
		INSERT INTO spans
		SELECT
			printf('base-%027d', i // 10), printf('%016d', i % 10), '', 'base', '',
			TIMESTAMP '2026-01-01' + i * INTERVAL 1 MICROSECOND,
			TIMESTAMP '2026-01-01' + i * INTERVAL 1 MICROSECOND + INTERVAL 1 MILLISECOND,
			'', '', '{}', '[]', 1, TIMESTAMP '2026-01-01'
		FROM range(?) AS rows(i)
	`, existingRows)
	if err != nil {
		b.Fatal(err)
	}
	if err := s.rebuildAllTraceSummaries(ctx); err != nil {
		b.Fatal(err)
	}
	return s
}
