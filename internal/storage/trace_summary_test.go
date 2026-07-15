package storage

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func TestTraceSummaries_IncrementalMatchesFullAggregation(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	resources := []ResourceRow{
		{ResourceHash: 1, ServiceName: "early-service", Attributes: map[string]any{"service.name": "early-service"}},
		{ResourceHash: 2, ServiceName: "late-service", Attributes: map[string]any{"service.name": "late-service"}},
	}

	// Arrive out of timestamp order. The second batch supplies both the true
	// start and the deterministic winner among equal-duration root spans.
	s.writeTraces(ctx, TraceBatch{Resources: resources, Spans: []SpanRow{
		{TraceID: "trace-a", SpanID: "child-late", ParentSpanID: "root-b", Name: "late child", StartTS: base.Add(20 * time.Millisecond), EndTS: base.Add(50 * time.Millisecond), StatusCode: "Error", ResourceHash: 2},
		{TraceID: "trace-a", SpanID: "root-b", Name: "root b", StartTS: base.Add(10 * time.Millisecond), EndTS: base.Add(30 * time.Millisecond), ResourceHash: 2},
		{TraceID: "trace-rootless", SpanID: "z", ParentSpanID: "missing", Name: "rootless late", StartTS: base.Add(30 * time.Millisecond), EndTS: base.Add(40 * time.Millisecond), ResourceHash: 2},
	}})
	s.writeTraces(ctx, TraceBatch{Resources: resources, Spans: []SpanRow{
		{TraceID: "trace-a", SpanID: "child-early", ParentSpanID: "root-a", Name: "early child", StartTS: base, EndTS: base.Add(5 * time.Millisecond), ResourceHash: 1},
		{TraceID: "trace-a", SpanID: "root-a", Name: "root a", StartTS: base.Add(5 * time.Millisecond), EndTS: base.Add(25 * time.Millisecond), ResourceHash: 1},
		{TraceID: "trace-rootless", SpanID: "a", ParentSpanID: "missing", Name: "rootless early", StartTS: base.Add(10 * time.Millisecond), EndTS: base.Add(20 * time.Millisecond), ResourceHash: 1},
	}})

	assertStoredTraceSummariesMatchAggregation(t, s, []string{"trace-a", "trace-rootless"})

	// Resend an existing key with different content. The indexed candidate
	// lookup must reject it and keep both facts and the incremental summary
	// equal to the aggregation oracle.
	s.writeTraces(ctx, TraceBatch{Resources: resources, Spans: []SpanRow{
		{TraceID: "trace-a", SpanID: "child-early", ParentSpanID: "root-a", Name: "mutated duplicate", StartTS: base.Add(-time.Hour), EndTS: base.Add(time.Hour), StatusCode: "Error", ResourceHash: 2},
	}})
	assertStoredTraceSummariesMatchAggregation(t, s, []string{"trace-a", "trace-rootless"})

	items, err := s.TraceSummariesByIDs(ctx, []string{"trace-a"})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].RootName != "root a" || items[0].ServiceName != "early-service" || items[0].SpanCount != 4 {
		t.Fatalf("incremental trace-a summary = %+v", items)
	}
}

func TestTraceSummaries_RebuildAllRepairsDerivedTable(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	resource := ResourceRow{ResourceHash: 1, ServiceName: "svc", Attributes: map[string]any{"service.name": "svc"}}
	s.writeTraces(ctx, TraceBatch{Resources: []ResourceRow{resource}, Spans: []SpanRow{
		{TraceID: "trace-a", SpanID: "root", Name: "root", StartTS: base, EndTS: base.Add(time.Second), ResourceHash: 1},
		{TraceID: "trace-a", SpanID: "child", ParentSpanID: "root", Name: "child", StartTS: base.Add(time.Millisecond), EndTS: base.Add(2 * time.Millisecond), StatusCode: "Error", ResourceHash: 1},
	}})
	if _, err := s.writer.ExecContext(ctx, `UPDATE trace_summaries SET trace_id = 'orphan' WHERE trace_id = 'trace-a'`); err != nil {
		t.Fatal(err)
	}
	if err := s.rebuildAllTraceSummaries(ctx); err != nil {
		t.Fatal(err)
	}
	assertStoredTraceSummariesMatchAggregation(t, s, []string{"trace-a"})
	var orphanCount int
	if err := s.DB().QueryRowContext(ctx, `SELECT count(*) FROM trace_summaries WHERE trace_id = 'orphan'`).Scan(&orphanCount); err != nil {
		t.Fatal(err)
	}
	if orphanCount != 0 {
		t.Fatalf("orphan summaries after rebuild = %d, want 0", orphanCount)
	}
}

func TestTraceSummaries_DedupCountsDuplicateKeyOnce(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	resource := ResourceRow{ResourceHash: 1, ServiceName: "svc", Attributes: map[string]any{"service.name": "svc"}}
	if err := s.upsertResources(ctx, []ResourceRow{resource}); err != nil {
		t.Fatal(err)
	}
	row := SpanRow{TraceID: "trace-a", SpanID: "span-a", Name: "span", StartTS: base, EndTS: base.Add(time.Second), ResourceHash: 1}
	retained, _, _, err := s.writeTraceRowsTransaction(ctx, []SpanRow{row, row}, base)
	if err != nil {
		t.Fatal(err)
	}
	if len(retained) != 1 {
		t.Fatalf("retained rows = %d, want 1", len(retained))
	}
	assertStoredTraceSummariesMatchAggregation(t, s, []string{"trace-a"})
}

func TestTraceSummaries_DedupPersistsAcrossReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "otelop.duckdb")
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	resource := ResourceRow{ResourceHash: 1, ServiceName: "svc", Attributes: map[string]any{"service.name": "svc"}}
	s, err := Open(ctx, Options{Path: path})
	if err != nil {
		t.Fatal(err)
	}
	s.writeTraces(ctx, TraceBatch{Resources: []ResourceRow{resource}, Spans: []SpanRow{
		{TraceID: "trace-a", SpanID: "span-a", Name: "original", StartTS: base, EndTS: base.Add(time.Second), ResourceHash: 1},
	}})
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	reopened := openTestStorage(t, Options{Path: path})
	reopened.writeTraces(ctx, TraceBatch{Resources: []ResourceRow{resource}, Spans: []SpanRow{
		{TraceID: "trace-a", SpanID: "span-a", Name: "mutated", StartTS: base.Add(-time.Hour), EndTS: base.Add(time.Hour), ResourceHash: 1},
	}})
	var count int
	var name string
	if err := reopened.DB().QueryRowContext(ctx, `SELECT count(*), min(name) FROM spans WHERE trace_id = 'trace-a'`).Scan(&count, &name); err != nil {
		t.Fatal(err)
	}
	if count != 1 || name != "original" {
		t.Fatalf("spans after reopen duplicate = count:%d name:%q", count, name)
	}
}

func TestTraceSummaries_DedupLookupBatchesManyExistingTraces(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	resource := ResourceRow{ResourceHash: 1, ServiceName: "svc", Attributes: map[string]any{"service.name": "svc"}}
	initial := make([]SpanRow, 40)
	second := make([]SpanRow, 0, 80)
	for i := range initial {
		traceID := fmt.Sprintf("trace-%02d", i)
		initial[i] = SpanRow{TraceID: traceID, SpanID: "existing", Name: "existing", StartTS: base, EndTS: base.Add(time.Second), ResourceHash: 1}
		second = append(second, initial[i], SpanRow{TraceID: traceID, SpanID: "new", Name: "new", StartTS: base, EndTS: base.Add(time.Second), ResourceHash: 1})
	}
	s.writeTraces(ctx, TraceBatch{Resources: []ResourceRow{resource}, Spans: initial})
	s.writeTraces(ctx, TraceBatch{Resources: []ResourceRow{resource}, Spans: second})
	var spanCount, summarySpanCount int
	if err := s.DB().QueryRowContext(ctx, `SELECT count(*) FROM spans`).Scan(&spanCount); err != nil {
		t.Fatal(err)
	}
	if err := s.DB().QueryRowContext(ctx, `SELECT sum(span_count) FROM trace_summaries`).Scan(&summarySpanCount); err != nil {
		t.Fatal(err)
	}
	if spanCount != 80 || summarySpanCount != 80 {
		t.Fatalf("counts after batched dedup = spans:%d summaries:%d, want 80", spanCount, summarySpanCount)
	}
}

func TestTraceSummaries_RollbackRemovesAppendedSpan(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if _, err := s.writer.ExecContext(ctx, `DROP TABLE trace_summaries`); err != nil {
		t.Fatal(err)
	}
	row := SpanRow{TraceID: "trace-a", SpanID: "span-a", Name: "span", StartTS: base, EndTS: base.Add(time.Second), ResourceHash: 1}
	if _, _, _, err := s.writeTraceRowsTransaction(ctx, []SpanRow{row}, base); err == nil {
		t.Fatal("write succeeded without trace_summaries table")
	}
	var spanCount int
	if err := s.DB().QueryRowContext(ctx, `SELECT count(*) FROM spans WHERE trace_id = 'trace-a'`).Scan(&spanCount); err != nil {
		t.Fatal(err)
	}
	if spanCount != 0 {
		t.Fatalf("span rows after rollback = %d, want 0", spanCount)
	}
}

func TestTraceSummaries_SweepRebuildsOnlyRetainedSpans(t *testing.T) {
	s := openTestStorage(t, Options{Retention: time.Hour})
	ctx := context.Background()
	now := time.Now()
	resources := []ResourceRow{
		{ResourceHash: 1, ServiceName: "expired-service", Attributes: map[string]any{"service.name": "expired-service"}},
		{ResourceHash: 2, ServiceName: "retained-service", Attributes: map[string]any{"service.name": "retained-service"}},
	}
	s.writeTraces(ctx, TraceBatch{Resources: resources, Spans: []SpanRow{
		{TraceID: "trace-a", SpanID: "root", Name: "expired root", StartTS: now.Add(-2 * time.Hour), EndTS: now.Add(-2*time.Hour + time.Second), StatusCode: "Error", ResourceHash: 1},
		{TraceID: "trace-a", SpanID: "child", ParentSpanID: "root", Name: "retained child", StartTS: now, EndTS: now.Add(time.Second), ResourceHash: 2},
	}})
	if err := s.Sweep(ctx); err != nil {
		t.Fatal(err)
	}

	items, err := s.TraceSummariesByIDs(ctx, []string{"trace-a"})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("summary count = %d, want 1", len(items))
	}
	got := items[0]
	if got.SpanCount != 1 || got.HasError || got.HasRoot || got.ServiceName != "retained-service" || !got.StartTime.Equal(now) {
		t.Fatalf("summary after sweep = %+v", got)
	}
	assertStoredTraceSummariesMatchAggregation(t, s, []string{"trace-a"})
}

func assertStoredTraceSummariesMatchAggregation(t *testing.T, s *Storage, traceIDs []string) {
	t.Helper()
	ctx := context.Background()
	stored, err := s.traceSummariesFromTable(ctx, s.DB(), traceIDs)
	if err != nil {
		t.Fatalf("stored summaries: %v", err)
	}
	aggregated, err := s.aggregateTraceSummariesByIDs(ctx, s.DB(), traceIDs)
	if err != nil {
		t.Fatalf("aggregated summaries: %v", err)
	}
	storedByID := make(map[string]TraceSummary, len(stored))
	for _, summary := range stored {
		storedByID[summary.TraceID] = summary
	}
	for _, want := range aggregated {
		got, ok := storedByID[want.TraceID]
		if !ok {
			t.Errorf("stored summary missing trace %q", want.TraceID)
			continue
		}
		if got.StartTime != want.StartTime || got.Duration != want.Duration || got.SpanCount != want.SpanCount ||
			got.HasError != want.HasError || got.ServiceName != want.ServiceName || got.HasRoot != want.HasRoot ||
			got.RootName != want.RootName || got.RootKind != want.RootKind || got.RootStatusCode != want.RootStatusCode ||
			got.RootDuration != want.RootDuration {
			t.Errorf("trace %q incremental = %+v, aggregation = %+v", want.TraceID, got, want)
		}
		delete(storedByID, want.TraceID)
	}
	if len(storedByID) != 0 {
		t.Errorf("incremental summaries not present in aggregation: %+v", storedByID)
	}
}
