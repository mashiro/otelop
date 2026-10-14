package graphql_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

func TestSpanLinksAPI(t *testing.T) {
	s := seedManyTraces(t, 1)
	td := ptrace.NewTraces()
	span := td.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	span.SetTraceID(pcommon.TraceID{9})
	span.SetSpanID(pcommon.SpanID{9})
	span.SetName("linked")
	span.SetDroppedLinksCount(5)
	for _, flags := range []uint32{0xffffffff, 0x100, 0x200} {
		link := span.Links().AppendEmpty()
		link.SetTraceID(pcommon.TraceID{1})
		link.SetSpanID(pcommon.SpanID{1, 0xA})
		link.SetFlags(flags)
	}
	span.Links().AppendEmpty()
	s.AddTraces(context.Background(), td)
	s.Sync()
	data := exec(t, s, `query($id:ID!){trace(traceId:$id){linkCount spans{linkCount droppedLinksCount links(first:20){hasNextPage items{flags traceFlags isRemote targetStatus target{name} source{name}}}}}}`, map[string]any{"id": span.TraceID().String()})
	tr := data["trace"].(map[string]any)
	if tr["linkCount"] != float64(4) {
		t.Fatalf("trace: %v", tr)
	}
	sp := tr["spans"].([]any)[0].(map[string]any)
	items := sp["links"].(map[string]any)["items"].([]any)
	a := items[0].(map[string]any)
	if a["flags"] != float64(0xffffffff) || a["isRemote"] != true || a["targetStatus"] != "AVAILABLE" {
		t.Fatalf("link: %v", a)
	}
	if items[1].(map[string]any)["isRemote"] != false || items[2].(map[string]any)["isRemote"] != nil || items[3].(map[string]any)["targetStatus"] != "INVALID_CONTEXT" {
		t.Fatalf("links: %v", items)
	}
}

func TestDocumentedSpanLinksQuery(t *testing.T) {
	s := seedManyTraces(t, 1)
	body, err := os.ReadFile("../docs/investigate-telemetry.md")
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	start := strings.Index(text, "query InvestigateSpanLinks(")
	if start < 0 {
		t.Fatal("missing documented query")
	}
	end := strings.Index(text[start:], "```")
	if end < 0 {
		t.Fatal("missing query fence")
	}
	data := exec(t, s, text[start:start+end], map[string]any{"traceId": pcommon.TraceID{1}.String(), "spanId": pcommon.SpanID{1, 0xA}.String()})
	if data["trace"] == nil {
		t.Fatal("documented query did not resolve seeded trace")
	}
}

func TestSpanAndLinkContext(t *testing.T) {
	for _, flags := range []uint32{0, 1, 0x100, 0x200, 0x300, 0xffffffff} {
		t.Run(fmt.Sprintf("%x", flags), func(t *testing.T) {
			s := seedManyTraces(t, 1)
			td := ptrace.NewTraces()
			spans := td.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty().Spans()
			for i := byte(1); i <= 2; i++ {
				sp := spans.AppendEmpty()
				sp.SetTraceID(pcommon.TraceID{9})
				sp.SetSpanID(pcommon.SpanID{i})
				if i == 2 {
					sp.SetParentSpanID(pcommon.SpanID{1})
				}
				sp.SetFlags(flags)
				sp.TraceState().FromRaw("vendor=value")
				link := sp.Links().AppendEmpty()
				link.SetFlags(flags)
				link.TraceState().FromRaw("vendor=value")
			}
			s.AddTraces(context.Background(), td)
			s.Sync()
			data := exec(t, s, `{trace(traceId:"09000000000000000000000000000000"){spans{parentSpanId flags traceFlags traceState parentIsRemote links{items{flags traceFlags traceState isRemote}}}}}`, nil)
			for _, raw := range data["trace"].(map[string]any)["spans"].([]any) {
				sp := raw.(map[string]any)
				link := sp["links"].(map[string]any)["items"].([]any)[0].(map[string]any)
				for _, context := range []map[string]any{sp, link} {
					if context["flags"] != float64(flags) || context["traceFlags"] != float64(flags&0xff) || context["traceState"] != "vendor=value" {
						t.Fatalf("context: %v", context)
					}
				}
				var remote any
				if flags&0x100 != 0 {
					remote = flags&0x200 != 0
				}
				if link["isRemote"] != remote {
					t.Fatalf("link remote: %v", link)
				}
				if sp["parentSpanId"] == "" {
					remote = nil
				}
				if sp["parentIsRemote"] != remote {
					t.Fatalf("parent remote: %v", sp)
				}
			}
		})
	}
}

func TestSpanContextMissingVersusZero(t *testing.T) {
	s := seedManyTraces(t, 1)
	query := `{trace(traceId:"01000000000000000000000000000000"){spans{flags traceFlags traceState parentIsRemote}}}`
	data := exec(t, s, query, nil)
	sp := data["trace"].(map[string]any)["spans"].([]any)[0].(map[string]any)
	if sp["flags"] != float64(0) || sp["traceFlags"] != float64(0) || sp["traceState"] != "" || sp["parentIsRemote"] != nil {
		t.Fatalf("zero context: %v", sp)
	}
	if _, err := s.DB().Exec(`UPDATE spans SET flags=NULL,trace_state=NULL`); err != nil {
		t.Fatal(err)
	}
	data = exec(t, s, query, nil)
	sp = data["trace"].(map[string]any)["spans"].([]any)[0].(map[string]any)
	for key, value := range sp {
		if value != nil {
			t.Fatalf("historical %s: %v", key, value)
		}
	}
}

func TestLinkPageDoesNotLoadWholeTrace(t *testing.T) {
	s := seedManyTraces(t, 1)
	exec(t, s, `{trace(traceId:"01000000000000000000000000000000"){span(spanId:"010a000000000000"){links{items{ordinal}} parent{spanId} trace{traceId}}}}`, nil)
	if got := s.TraceByIDCalls(); got != 0 {
		t.Fatalf("loaded full trace %d times", got)
	}
}

func TestSpanLinkLookup(t *testing.T) {
	s := seedManyTraces(t, 1)
	td := ptrace.NewTraces()
	sp := td.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	sp.SetTraceID(pcommon.TraceID{9})
	sp.SetSpanID(pcommon.SpanID{9})
	for i := 0; i < 25; i++ {
		link := sp.Links().AppendEmpty()
		link.SetTraceID(pcommon.TraceID{8})
		link.SetSpanID(pcommon.SpanID{8})
		link.Attributes().PutInt("index", int64(i))
	}
	s.AddTraces(context.Background(), td)
	s.Sync()
	query := `{spanLink(sourceTraceId:"09000000000000000000000000000000",sourceSpanId:"0900000000000000",ordinal:24){ordinal attributes targetStatus target{name}} missing:spanLink(sourceTraceId:"09000000000000000000000000000000",sourceSpanId:"0900000000000000",ordinal:25){ordinal}}`
	data := exec(t, s, query, nil)
	link := data["spanLink"].(map[string]any)
	if link["ordinal"] != float64(24) || link["target"] != nil || link["targetStatus"] != "NOT_FOUND" || data["missing"] != nil {
		t.Fatalf("unexpected links: %v", data)
	}
	if link["attributes"].(map[string]any)["index"] != float64(24) {
		t.Fatalf("wrong link attributes: %v", link)
	}
	if err := s.Clear(context.Background()); err != nil {
		t.Fatal(err)
	}
	data = exec(t, s, query, nil)
	if data["spanLink"] != nil {
		t.Fatalf("deleted link remains: %v", data)
	}

}

func TestSpanLinkAttributeProjection(t *testing.T) {
	s := seedManyTraces(t, 1)
	td := ptrace.NewTraces()
	sp := td.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	sp.SetTraceID(pcommon.TraceID{9})
	sp.SetSpanID(pcommon.SpanID{9})
	link := sp.Links().AppendEmpty()
	link.SetTraceID(pcommon.TraceID{1})
	link.SetSpanID(pcommon.SpanID{1, 0xA})
	link.Attributes().PutStr("payload", "detail")
	s.AddTraces(context.Background(), td)
	s.Sync()
	data := exec(t, s, `query {trace(traceId:"09000000000000000000000000000000"){span(spanId:"0900000000000000"){links{items{...Attrs}}}}} fragment Attrs on SpanLink { payload:attributes }`, nil)
	items := data["trace"].(map[string]any)["span"].(map[string]any)["links"].(map[string]any)["items"].([]any)
	if items[0].(map[string]any)["payload"].(map[string]any)["payload"] != "detail" {
		t.Fatalf("lost selected attributes: %v", items)
	}
	if _, err := s.DB().Exec(`UPDATE span_links SET attributes='[1]'`); err != nil {
		t.Fatal(err)
	}
	// Both list directions must skip decoding unselected attributes.
	exec(t, s, `{trace(traceId:"09000000000000000000000000000000"){span(spanId:"0900000000000000"){links{items{ordinal targetStatus}}}}}`, nil)
	exec(t, s, `{trace(traceId:"01000000000000000000000000000000"){span(spanId:"010a000000000000"){incomingLinks{items{ordinal source{name}}}}}}`, nil)
}
