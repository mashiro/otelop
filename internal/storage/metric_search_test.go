package storage

import (
	"context"
	"slices"
	"testing"
	"time"
)

func TestMetricFilters(t *testing.T) {
	s := openTestStorage(t, Options{})
	ctx := context.Background()
	now := time.Now()
	for _, spec := range []struct {
		method string
		status int64
	}{{"GET", 200}, {"POST", 500}} {
		md := buildDeltaSum("http.requests", "api", 1, now)
		rm := md.ResourceMetrics().At(0)
		rm.Resource().Attributes().PutStr("deployment.environment", "prod")
		m := rm.ScopeMetrics().At(0).Metrics().At(0)
		m.SetUnit("1")
		m.SetDescription("Request count")
		dp := m.Sum().DataPoints().At(0)
		dp.Attributes().PutStr("http.method", spec.method)
		dp.Attributes().PutInt("http.status_code", spec.status)
		s.AddMetrics(ctx, md)
	}
	s.AddMetrics(ctx, buildDeltaSum("jobs.completed", "worker", 2, now))
	s.Sync()
	for _, tc := range []struct {
		search string
		count  int
	}{
		{"service_name:api", 1}, {"name:http.* type:Sum unit:1", 1},
		{"requests resource.deployment.environment:prod", 1},
		{"description:\"Request count\"", 1},
		{"attributes.http.method:GET attributes.http.status_code:>=500", 0},
		{"attributes.http.method:POST attributes.http.status_code:>=500", 1},
		{"-attributes.http.method:GET name:http.*", 1},
		{"attributes.missing:*", 0}, {"-attributes.missing:*", 2},
		{"service_name:missing", 0}, {"name:\"http.*\"", 0},
	} {
		t.Run(tc.search, func(t *testing.T) {
			got, _, err := s.MetricsPageSearch(ctx, now.Add(-time.Hour), now.Add(time.Hour), nil, 0, tc.search)
			if err != nil {
				t.Fatal(err)
			}
			if len(got) != tc.count {
				t.Fatalf("got %d want %d", len(got), tc.count)
			}
			if len(got) == 1 && got[0].MetricName == "http.requests" && len(got[0].SeriesKeys) != 2 {
				t.Fatal("list filters must preserve all series in the matching metric")
			}
		})
	}
	for _, tc := range []struct {
		key, input string
		want       []string
	}{
		{"", "http.method", []string{"attributes.http.method"}},
		{"service_name", "", []string{"api", "worker"}},
		{"type", "", []string{"Sum"}},
		{"attributes.http.method", "", []string{"GET", "POST"}},
		{"resource.deployment.environment", "", []string{"prod"}},
	} {
		got, err := s.FilterSuggestions(ctx, "metrics", tc.key, tc.input, now.Add(-time.Hour), now.Add(time.Hour))
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(got, tc.want) {
			t.Fatalf("%s: got %v want %v", tc.key, got, tc.want)
		}
	}
}
