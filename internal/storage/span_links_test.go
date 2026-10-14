package storage

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
)

func TestSpanLinksRoundTrip(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now().UTC()
	td := buildTracesMulti(spanSpec{traceID: [16]byte{1}, spanID: [8]byte{1}, name: "consumer", start: now, end: now.Add(time.Second)})
	span := td.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0)
	span.SetDroppedLinksCount(3)
	for i := 0; i < 23; i++ {
		link := span.Links().AppendEmpty()
		link.SetTraceID(pcommon.TraceID{2})
		link.SetSpanID(pcommon.SpanID{2})
		link.SetFlags(0xffffffff)
		link.TraceState().FromRaw("vendor=value")
		link.Attributes().PutInt("index", int64(i))
		link.SetDroppedAttributesCount(2)
	}
	span.Links().AppendEmpty()
	s.AddTraces(ctx, td)
	s.AddTraces(ctx, td)
	s.Sync()
	id := span.TraceID().String()
	detail, ok, err := s.TraceByID(ctx, id)
	if err != nil || !ok {
		t.Fatalf("detail: %v", err)
	}
	if detail.LinkCount != 24 || detail.Spans[0].DroppedLinksCount != 3 {
		t.Fatalf("detail: %+v", detail)
	}
	page, err := s.SpanLinks(ctx, id, span.SpanID().String(), false, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 20 || !page.HasNextPage || page.Items[0].Flags != 0xffffffff || page.Items[0].Target != nil {
		t.Fatalf("page: %+v", page)
	}
	for _, first := range []int{0, -1, 101} {
		if _, err := s.SpanLinks(ctx, id, span.SpanID().String(), false, "", first); err == nil {
			t.Fatalf("accepted first=%d", first)
		}
	}
	for _, wrong := range []struct {
		id       string
		incoming bool
	}{{"another", false}, {id, true}} {
		if _, err := s.SpanLinks(ctx, wrong.id, span.SpanID().String(), wrong.incoming, page.EndCursor, 20); err == nil {
			t.Fatal("accepted cursor for different scope")
		}
	}
	if page.Items[0].TraceState != "vendor=value" || page.Items[0].DroppedAttributesCount != 2 {
		t.Fatalf("lost metadata: %+v", page.Items[0])
	}
	for i, link := range page.Items {
		if link.Ordinal != i || link.Attributes["index"] != float64(i) {
			t.Fatalf("lost order or attributes: %+v", link)
		}
	}
	summaries, _, err := s.TracesPage(ctx, now.Add(-time.Minute), now.Add(time.Minute), nil, 20, "")
	if err != nil || len(summaries) != 1 || summaries[0].LinkCount != 24 {
		t.Fatalf("list count: %+v %v", summaries, err)
	}
	page, err = s.SpanLinks(ctx, id, span.SpanID().String(), false, page.EndCursor, 20)
	if err != nil || len(page.Items) != 4 || page.HasNextPage {
		t.Fatalf("second page: %+v %v", page, err)
	}
	target := buildTracesMulti(spanSpec{traceID: [16]byte{2}, spanID: [8]byte{2}, name: "producer", start: now.Add(-time.Hour), end: now.Add(-time.Hour + time.Second)})
	s.AddTraces(ctx, target)
	s.Sync()
	incoming, err := s.SpanLinks(ctx, pcommon.TraceID{2}.String(), pcommon.SpanID{2}.String(), true, "", 100)
	if err != nil || len(incoming.Items) != 23 || incoming.Items[0].Source == nil {
		t.Fatalf("incoming: %+v %v", incoming, err)
	}
	if incoming.Items[0].Flags != 0xffffffff || incoming.Items[0].TraceState != "vendor=value" {
		t.Fatal("target arrival changed link context")
	}
	if incoming.Items[0].Target == nil {
		t.Fatal("late target did not resolve")
	}
	incomingFirst, err := s.SpanLinks(ctx, pcommon.TraceID{2}.String(), pcommon.SpanID{2}.String(), true, "", 20)
	if err != nil || !incomingFirst.HasNextPage {
		t.Fatalf("incoming first: %v", err)
	}
	incomingLast, err := s.SpanLinks(ctx, pcommon.TraceID{2}.String(), pcommon.SpanID{2}.String(), true, incomingFirst.EndCursor, 20)
	if err != nil || len(incomingLast.Items) != 3 || incomingLast.HasNextPage {
		t.Fatalf("incoming last: %+v %v", incomingLast, err)
	}
	if _, err := s.deleteFactsBefore(ctx, now.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	page, err = s.SpanLinks(ctx, id, span.SpanID().String(), false, "", 20)
	if err != nil || len(page.Items) != 20 || page.Items[0].Target != nil {
		t.Fatalf("missing target: %+v %v", page, err)
	}
	if page.Items[0].Flags != 0xffffffff || page.Items[0].TraceState != "vendor=value" {
		t.Fatal("target removal changed link context")
	}
	if _, err := s.deleteFactsBefore(ctx, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.DB().QueryRowContext(ctx, "SELECT count(*) FROM span_links").Scan(&count); err != nil || count != 0 {
		t.Fatalf("orphan links: %d %v", count, err)
	}
}

func TestSpanLinkSummarySkipsAttributes(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now().UTC()
	td := buildTracesMulti(spanSpec{traceID: [16]byte{1}, spanID: [8]byte{1}, name: "source", start: now, end: now.Add(time.Second)})
	span := td.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0)
	span.Links().AppendEmpty().Attributes().PutStr("payload", "detail only")
	s.AddTraces(ctx, td)
	s.Sync()
	page, err := s.SpanLinkSummaries(ctx, span.TraceID().String(), span.SpanID().String(), false, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Attributes != nil {
		t.Fatalf("summary decoded attributes: %+v", page)
	}
	detail, err := s.SpanLinkByID(ctx, span.TraceID().String(), span.SpanID().String(), 0)
	if err != nil || detail.Attributes["payload"] != "detail only" {
		t.Fatalf("detail lost attributes: %+v %v", detail, err)
	}
	// A non-object JSON payload proves the summary path does not decode attributes.
	if _, err := s.DB().ExecContext(ctx, `UPDATE span_links SET attributes='[1]'`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SpanLinkSummaries(ctx, span.TraceID().String(), span.SpanID().String(), false, "", 20); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SpanLinkByID(ctx, span.TraceID().String(), span.SpanID().String(), 0); err == nil {
		t.Fatal("detail should decode attributes")
	}
}
