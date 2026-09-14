package storage

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
)

func TestFilterSuggestions(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	base := time.Date(2026, 1, 1, 0, 0, 0, 123456789, time.UTC)
	for i := range 130 {
		ld := plog.NewLogs()
		rl := ld.ResourceLogs().AppendEmpty()
		rl.Resource().Attributes().PutStr("service.name", "hidden-service")
		rl.Resource().Attributes().PutStr("deployment.environment", "staging")
		log := rl.ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
		log.SetTimestamp(pcommon.NewTimestampFromTime(base))
		log.Attributes().PutStr("request.id", fmt.Sprintf("item-%03d", i))
		log.Attributes().PutStr(fmt.Sprintf("key-%03d", i), "value")
		log.Attributes().PutStr("a.b/~", "100%_日本語")
		log.Attributes().PutEmptyMap("object").PutStr("nested", "not-a-scalar")
		log.Attributes().PutBool("retry", true)
		log.Attributes().PutInt("status", 500)
		s.AddLogs(ctx, ld)
	}
	td := buildTracesMulti(spanSpec{traceID: [16]byte{1}, spanID: [8]byte{1}, name: "hidden-root", service: "api", start: base, end: base.Add(time.Millisecond)}, spanSpec{traceID: [16]byte{1}, spanID: [8]byte{2}, parentID: [8]byte{1}, name: "hidden-child", service: "worker", start: base.Add(time.Hour), end: base.Add(time.Hour + time.Millisecond)})
	td.ResourceSpans().At(1).ScopeSpans().At(0).Spans().At(0).Attributes().PutStr("unloaded.key", "unloaded-value")
	s.AddTraces(ctx, td)
	s.Sync()
	for _, tc := range []struct {
		signal, key, input string
		want               []string
	}{
		{"logs", "", "request", []string{"attributes.request.id"}},
		{"logs", "", "service", []string{"resource.service.name", "service_name"}},
		{"logs", "request.id", "", nil},
		{"logs", "attributes.request.id", "item-129", []string{"item-129"}},
		{"logs", "attributes.a.b/~", "%_", []string{"100%_日本語"}},
		{"logs", "attributes.a.b/~", "日本", []string{"100%_日本語"}},
		{"logs", "attributes.object", "", []string{}},
		{"logs", "attributes.retry", "", []string{"true"}},
		{"logs", "attributes.status", "", []string{"500"}},
		{"logs", "resource.deployment.environment", "STAG", []string{"staging"}},
		{"logs", "service_name", "hidden", []string{"hidden-service"}},
		{"logs", "trace_id", "", []string{}},
		{"traces", "", "unloaded", []string{"attributes.unloaded.key"}},
		{"traces", "attributes.unloaded.key", "", []string{"unloaded-value"}},
		{"traces", "name", "child", []string{"hidden-child"}},
		{"traces", "duration_ms", "", []string{"1.0"}},
		{"traces", "parent_span_id", "", []string{"0100000000000000"}},
	} {
		t.Run(tc.signal+"/"+tc.key+"/"+tc.input, func(t *testing.T) {
			got, err := s.FilterSuggestions(ctx, tc.signal, tc.key, tc.input, base, base.Add(time.Second))
			if tc.want == nil {
				if err == nil {
					t.Fatal("expected invalid key error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(got, tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
	keys, err := s.FilterSuggestions(ctx, "logs", "", "attributes.key-", base, base.Add(time.Second))
	if err != nil || len(keys) != 130 || keys[129] != "attributes.key-129" {
		t.Fatalf("all keys: %v %v", keys, err)
	}
	values, err := s.FilterSuggestions(ctx, "logs", "attributes.request.id", "", base, base.Add(time.Second))
	if err != nil || len(values) != 20 || values[19] != "item-019" {
		t.Fatalf("limit/sort: %v %v", values, err)
	}
	for _, signal := range []string{"logs", "traces"} {
		key := "attributes.request.id"
		if signal == "traces" {
			key = "attributes.unloaded.key"
		}
		for _, bounds := range [][2]time.Time{{base.Add(time.Nanosecond), base.Add(time.Second)}, {base.Add(-time.Second), base}} {
			got, err := s.FilterSuggestions(ctx, signal, key, "", bounds[0], bounds[1])
			if err != nil || len(got) != 0 {
				t.Fatalf("nanosecond window: %v %v", got, err)
			}
		}
	}
	if _, err := s.FilterSuggestions(ctx, "invalid", "", "", base, base.Add(time.Second)); err == nil {
		t.Fatal("invalid signal accepted")
	}
}

func BenchmarkLogFilterSuggestions(b *testing.B) {
	s, from, to := benchmarkLogSearchStorage(b, 1_000_000)
	for _, tc := range []struct{ name, key, input string }{
		{"keys", "", ""}, {"filtered_keys", "", "http"}, {"values", "attributes.request.id", ""}, {"filtered_values", "attributes.request.id", "000000000042"}, {"resource_values", "resource.service.name", ""},
	} {
		b.Run(tc.name, func(b *testing.B) {
			for range b.N {
				_, err := s.FilterSuggestions(context.Background(), "logs", tc.key, tc.input, from, to)
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func TestFilterSuggestions_KeyHardLimit(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now()
	ld := plog.NewLogs()
	log := ld.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	log.SetTimestamp(pcommon.NewTimestampFromTime(now))
	for i := range 1010 {
		log.Attributes().PutStr(fmt.Sprintf("limit.%04d", i), "value")
	}
	s.AddLogs(ctx, ld)
	s.Sync()
	keys, err := s.FilterSuggestions(ctx, "logs", "", "", now.Add(-time.Second), now.Add(time.Second))
	if err != nil || len(keys) != 1000 {
		t.Fatalf("hard limit: %d keys, %v", len(keys), err)
	}
	keys, err = s.FilterSuggestions(ctx, "logs", "", "limit.1009", now.Add(-time.Second), now.Add(time.Second))
	if err != nil || !slices.Equal(keys, []string{"attributes.limit.1009"}) {
		t.Fatalf("filter before limit: %v %v", keys, err)
	}
}
