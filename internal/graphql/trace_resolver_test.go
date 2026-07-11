package graphql_test

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"

	"github.com/mashiro/otelop/internal/storage"
)

// seedManyTraces creates n independent two-span traces (root + error child),
// mirroring the shape use-initial-load.ts's trimmed list query renders:
// summary fields plus rootSpan's name/kind/status/duration. It's the
// regression fixture for the N+1 that self-telemetry surfaced — a
// traces-list query resolving rootSpan for every row must not run one
// TraceByID SQL round trip per row.
func seedManyTraces(t *testing.T, n int) *storage.Storage {
	t.Helper()
	s := newTestStorage(t)
	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "svc-n1")
	ss := rs.ScopeSpans().AppendEmpty()

	base := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < n; i++ {
		var traceID [16]byte
		traceID[0] = byte(i + 1)
		traceID[1] = byte((i + 1) >> 8)

		root := ss.Spans().AppendEmpty()
		root.SetTraceID(pcommon.TraceID(traceID))
		root.SetSpanID(pcommon.SpanID([8]byte{byte(i + 1), 0xA}))
		root.SetName("root")
		root.SetKind(ptrace.SpanKindServer)
		root.SetStartTimestamp(pcommon.NewTimestampFromTime(base.Add(time.Duration(i) * time.Second)))
		root.SetEndTimestamp(pcommon.NewTimestampFromTime(base.Add(time.Duration(i)*time.Second + 5*time.Millisecond)))
		root.Status().SetCode(ptrace.StatusCodeOk)

		child := ss.Spans().AppendEmpty()
		child.SetTraceID(pcommon.TraceID(traceID))
		child.SetSpanID(pcommon.SpanID([8]byte{byte(i + 1), 0xB}))
		child.SetParentSpanID(root.SpanID())
		child.SetName("child")
		child.SetStartTimestamp(pcommon.NewTimestampFromTime(base.Add(time.Duration(i)*time.Second + time.Millisecond)))
		child.SetEndTimestamp(pcommon.NewTimestampFromTime(base.Add(time.Duration(i)*time.Second + 3*time.Millisecond)))
	}

	s.AddTraces(context.Background(), td)
	s.Sync()
	return s
}

// TestTracesList_SummaryFieldsDoNotTriggerTraceByID is the GraphQL-level
// regression test for the N+1 self-telemetry made visible: 815 x Trace.spans
// (renamed Trace.rootSpan once use-initial-load.ts stopped requesting
// `spans`) each firing a TraceByID SQL round trip. Every field the trace
// LIST renders — including rootSpan's name/kind/status/duration — must
// resolve from the TracesPage summary alone.
func TestTracesList_SummaryFieldsDoNotTriggerTraceByID(t *testing.T) {
	const n = 25
	s := seedManyTraces(t, n)

	data := exec(t, s, `{
		traces(limit: 0) {
			total
			items {
				traceId
				serviceName
				spanCount
				durationMs
				startTime
				hasError
				rootSpan { name kind statusCode durationMs }
			}
		}
	}`, nil)

	conn := data["traces"].(map[string]any)
	if int(conn["total"].(float64)) != n {
		t.Fatalf("total = %v, want %d", conn["total"], n)
	}
	items := conn["items"].([]any)
	if len(items) != n {
		t.Fatalf("items len = %d, want %d", len(items), n)
	}
	for _, it := range items {
		row := it.(map[string]any)
		root := row["rootSpan"].(map[string]any)
		if root["name"] != "root" {
			t.Errorf("rootSpan.name = %v, want %q", root["name"], "root")
		}
		if root["kind"] != "Server" {
			t.Errorf("rootSpan.kind = %v, want %q", root["kind"], "Server")
		}
		if root["statusCode"] != "Ok" {
			t.Errorf("rootSpan.statusCode = %v, want Ok", root["statusCode"])
		}
	}

	if got := s.TraceByIDCalls(); got != 0 {
		t.Errorf("TraceByIDCalls = %d, want 0 (summary-only fields must not trigger the per-trace detail fetch)", got)
	}
}

// TestTracesList_SearchArgFiltersAndReflectsInTotal is the GraphQL-level
// passthrough check for issue #161's `search` arg — the field-matching
// semantics themselves are covered exhaustively at the storage layer
// (query_trace_search_test.go); this just confirms the resolver actually
// forwards the arg to storage.TracesPage rather than ignoring it.
func TestTracesList_SearchArgFiltersAndReflectsInTotal(t *testing.T) {
	s := seedManyTraces(t, 3)

	data := exec(t, s, `{
		traces(limit: 0, search: "root") {
			total
			items { traceId }
		}
	}`, nil)
	conn := data["traces"].(map[string]any)
	if int(conn["total"].(float64)) != 3 {
		t.Fatalf("total = %v, want 3 (every trace's root span is named \"root\")", conn["total"])
	}

	data = exec(t, s, `{
		traces(limit: 0, search: "no-such-trace") {
			total
			items { traceId }
		}
	}`, nil)
	conn = data["traces"].(map[string]any)
	if int(conn["total"].(float64)) != 0 {
		t.Fatalf("total = %v, want 0", conn["total"])
	}
	if len(conn["items"].([]any)) != 0 {
		t.Fatalf("items = %v, want empty", conn["items"])
	}
}

// TestTrace_SpansStillTriggersDetailFetch guards the other half of the
// contract: a query that genuinely needs full span data (spans, or a
// rootSpan sub-field the summary doesn't carry) must still work — the fix
// only removes the *unnecessary* fetch, not the capability.
func TestTrace_SpansStillTriggersDetailFetch(t *testing.T) {
	s := seedManyTraces(t, 1)

	data := exec(t, s, `{
		traces(limit: 0) {
			items {
				spanCount
				spans { name parentSpanId }
			}
		}
	}`, nil)

	items := data["traces"].(map[string]any)["items"].([]any)
	row := items[0].(map[string]any)
	spans := row["spans"].([]any)
	if len(spans) != 2 {
		t.Fatalf("spans len = %d, want 2", len(spans))
	}
	if got := s.TraceByIDCalls(); got != 1 {
		t.Errorf("TraceByIDCalls = %d, want 1 (spans field genuinely needs the detail fetch)", got)
	}
}
