package storage

import (
	"math"
	"reflect"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

func TestConvertTraces_MapsSpanFieldsAndDedupsResources(t *testing.T) {
	td := ptrace.NewTraces()

	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "svc-a")
	ss := rs.ScopeSpans().AppendEmpty()

	span := ss.Spans().AppendEmpty()
	span.SetTraceID(pcommon.TraceID([16]byte{1}))
	span.SetSpanID(pcommon.SpanID([8]byte{1}))
	span.SetParentSpanID(pcommon.SpanID([8]byte{2}))
	span.SetName("op-a")
	span.SetKind(ptrace.SpanKindServer)
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(50 * time.Millisecond)
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(start))
	span.SetEndTimestamp(pcommon.NewTimestampFromTime(end))
	span.Status().SetCode(ptrace.StatusCodeError)
	span.Status().SetMessage("boom")
	span.Attributes().PutStr("http.method", "GET")
	ev := span.Events().AppendEmpty()
	ev.SetName("exception")
	ev.SetTimestamp(pcommon.NewTimestampFromTime(start.Add(time.Millisecond)))
	ev.Attributes().PutStr("exception.type", "Boom")

	// Second resource span sharing the identical resource attributes: must
	// dedupe to a single ResourceRow.
	rs2 := td.ResourceSpans().AppendEmpty()
	rs2.Resource().Attributes().PutStr("service.name", "svc-a")
	ss2 := rs2.ScopeSpans().AppendEmpty()
	span2 := ss2.Spans().AppendEmpty()
	span2.SetTraceID(pcommon.TraceID([16]byte{1}))
	span2.SetSpanID(pcommon.SpanID([8]byte{3}))
	span2.SetName("op-b")
	span2.SetStartTimestamp(pcommon.NewTimestampFromTime(start))
	span2.SetEndTimestamp(pcommon.NewTimestampFromTime(end))

	batch := ConvertTraces(td)

	if len(batch.Resources) != 1 {
		t.Fatalf("expected 1 deduped resource, got %d", len(batch.Resources))
	}
	if batch.Resources[0].ServiceName != "svc-a" {
		t.Errorf("ServiceName = %q, want svc-a", batch.Resources[0].ServiceName)
	}

	if len(batch.Spans) != 2 {
		t.Fatalf("expected 2 spans, got %d", len(batch.Spans))
	}
	sp := batch.Spans[0]
	if sp.TraceID != span.TraceID().String() || sp.SpanID != span.SpanID().String() {
		t.Errorf("span identity not preserved: %+v", sp)
	}
	if sp.ParentSpanID != span.ParentSpanID().String() {
		t.Errorf("ParentSpanID = %q, want %q", sp.ParentSpanID, span.ParentSpanID().String())
	}
	if sp.Name != "op-a" || sp.Kind != "Server" {
		t.Errorf("Name/Kind = %q/%q, want op-a/Server", sp.Name, sp.Kind)
	}
	if !sp.StartTS.Equal(start) || !sp.EndTS.Equal(end) {
		t.Errorf("StartTS/EndTS = %v/%v, want %v/%v", sp.StartTS, sp.EndTS, start, end)
	}
	if sp.StatusCode != "Error" || sp.StatusMessage != "boom" {
		t.Errorf("StatusCode/StatusMessage = %q/%q, want Error/boom", sp.StatusCode, sp.StatusMessage)
	}
	if sp.Attributes["http.method"] != "GET" {
		t.Errorf("Attributes[http.method] = %v, want GET", sp.Attributes["http.method"])
	}
	if len(sp.Events) != 1 || sp.Events[0].Name != "exception" {
		t.Fatalf("expected 1 exception event, got %+v", sp.Events)
	}
	if sp.Events[0].Attributes["exception.type"] != "Boom" {
		t.Errorf("event attribute not preserved: %+v", sp.Events[0].Attributes)
	}
	if sp.ResourceHash != batch.Resources[0].ResourceHash {
		t.Errorf("span ResourceHash = %d, want %d", sp.ResourceHash, batch.Resources[0].ResourceHash)
	}

	sp2 := batch.Spans[1]
	if len(sp2.Events) != 0 {
		t.Errorf("expected no events on span2, got %+v", sp2.Events)
	}
	if sp2.ResourceHash != batch.Resources[0].ResourceHash {
		t.Error("span2 should reference the same deduped resource")
	}
}

func TestConvertTraces_RootSpanEmptyParentID(t *testing.T) {
	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	ss := rs.ScopeSpans().AppendEmpty()
	span := ss.Spans().AppendEmpty()
	span.SetTraceID(pcommon.TraceID([16]byte{1}))
	span.SetSpanID(pcommon.SpanID([8]byte{1}))
	// ParentSpanID left unset -> zero value, which pdata renders as "".

	batch := ConvertTraces(td)
	if len(batch.Spans) != 1 {
		t.Fatalf("expected 1 span, got %d", len(batch.Spans))
	}
	if batch.Spans[0].ParentSpanID != "" {
		t.Errorf("ParentSpanID = %q, want empty string for a root span", batch.Spans[0].ParentSpanID)
	}
}

func TestConvertLogs_MapsFieldsAndAssignsUniqueUUIDv7Ids(t *testing.T) {
	ld := plog.NewLogs()
	rl := ld.ResourceLogs().AppendEmpty()
	rl.Resource().Attributes().PutStr("service.name", "svc")
	sl := rl.ScopeLogs().AppendEmpty()

	ts := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 2; i++ {
		lr := sl.LogRecords().AppendEmpty()
		lr.SetTimestamp(pcommon.NewTimestampFromTime(ts))
		lr.SetObservedTimestamp(pcommon.NewTimestampFromTime(ts))
		lr.SetTraceID(pcommon.TraceID([16]byte{1}))
		lr.SetSpanID(pcommon.SpanID([8]byte{1}))
		lr.SetSeverityNumber(plog.SeverityNumberError)
		lr.SetSeverityText("ERROR")
		lr.Body().SetStr("boom")
		lr.Attributes().PutStr("k", "v")
	}

	batch := ConvertLogs(ld)
	if len(batch.Resources) != 1 {
		t.Fatalf("expected 1 resource row, got %d", len(batch.Resources))
	}
	if len(batch.Logs) != 2 {
		t.Fatalf("expected 2 log rows, got %d", len(batch.Logs))
	}

	l := batch.Logs[0]
	if !l.TS.Equal(ts) || !l.ObservedTS.Equal(ts) {
		t.Errorf("TS/ObservedTS = %v/%v, want %v", l.TS, l.ObservedTS, ts)
	}
	if l.SeverityNumber != int32(plog.SeverityNumberError) || l.SeverityText != "ERROR" {
		t.Errorf("severity not preserved: %d %q", l.SeverityNumber, l.SeverityText)
	}
	if l.Body != "boom" {
		t.Errorf("Body = %q, want boom", l.Body)
	}
	if l.Attributes["k"] != "v" {
		t.Errorf("Attributes[k] = %v, want v", l.Attributes["k"])
	}
	if l.ResourceHash != batch.Resources[0].ResourceHash {
		t.Error("log ResourceHash should match the deduped resource")
	}

	if batch.Logs[0].ID == batch.Logs[1].ID {
		t.Fatal("expected distinct ids for distinct log records")
	}
	if batch.Logs[0].ID.Version() != 7 {
		t.Errorf("id version = %d, want 7 (UUIDv7)", batch.Logs[0].ID.Version())
	}
}

func TestConvertLogs_FallsBackToObservedTimestamp(t *testing.T) {
	ld := plog.NewLogs()
	lr := ld.ResourceLogs().AppendEmpty().ScopeLogs().AppendEmpty().LogRecords().AppendEmpty()
	observed := time.Date(2026, 7, 12, 6, 30, 0, 0, time.UTC)
	lr.SetObservedTimestamp(pcommon.NewTimestampFromTime(observed))

	batch := ConvertLogs(ld)
	if len(batch.Logs) != 1 {
		t.Fatalf("Logs len = %d, want 1", len(batch.Logs))
	}
	if !batch.Logs[0].TS.Equal(observed) {
		t.Errorf("TS = %v, want observed timestamp %v", batch.Logs[0].TS, observed)
	}
	if !batch.Logs[0].ObservedTS.Equal(observed) {
		t.Errorf("ObservedTS = %v, want %v", batch.Logs[0].ObservedTS, observed)
	}
}

func TestConvertMetrics_Gauge(t *testing.T) {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")
	sm := rm.ScopeMetrics().AppendEmpty()
	sm.SetSchemaUrl("https://opentelemetry.io/schemas/1.30.0")
	sm.Scope().SetName("example.metrics")
	sm.Scope().SetVersion("1.2.3")
	sm.Scope().Attributes().PutStr("library.language", "go")
	m := sm.Metrics().AppendEmpty()
	m.SetName("cpu.usage")
	m.SetUnit("1")
	m.SetDescription("cpu")
	dp := m.SetEmptyGauge().DataPoints().AppendEmpty()
	dp.SetDoubleValue(0.5)
	ts := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	dp.SetTimestamp(pcommon.NewTimestampFromTime(ts))
	dp.Attributes().PutStr("cpu", "0")

	batch := ConvertMetrics(md)
	if len(batch.Resources) != 1 {
		t.Fatalf("expected 1 resource row, got %d", len(batch.Resources))
	}
	if batch.Resources[0].ServiceName != "svc" {
		t.Errorf("resource ServiceName = %q, want svc", batch.Resources[0].ServiceName)
	}
	if len(batch.Series) != 1 {
		t.Fatalf("expected 1 series row, got %d", len(batch.Series))
	}
	series := batch.Series[0]
	if series.ResourceHash != batch.Resources[0].ResourceHash {
		t.Errorf("series ResourceHash = %d, want %d (the batch's resource row)", series.ResourceHash, batch.Resources[0].ResourceHash)
	}
	if series.MetricType != pmetric.MetricTypeGauge.String() {
		t.Errorf("MetricType = %q, want %q", series.MetricType, pmetric.MetricTypeGauge.String())
	}
	if series.Temporality != "" || series.IsMonotonic {
		t.Errorf("Gauge series should have no temporality/monotonicity, got %q/%v", series.Temporality, series.IsMonotonic)
	}
	if series.Unit != "1" || series.Description != "cpu" {
		t.Errorf("Unit/Description = %q/%q, want 1/cpu", series.Unit, series.Description)
	}
	if series.ScopeName != "example.metrics" || series.ScopeVersion != "1.2.3" {
		t.Errorf("ScopeName/ScopeVersion = %q/%q, want example.metrics/1.2.3", series.ScopeName, series.ScopeVersion)
	}
	if series.ScopeSchemaURL != "https://opentelemetry.io/schemas/1.30.0" {
		t.Errorf("ScopeSchemaURL = %q", series.ScopeSchemaURL)
	}
	if series.ScopeAttributes["library.language"] != "go" {
		t.Errorf("ScopeAttributes = %v, want library.language=go", series.ScopeAttributes)
	}

	if len(batch.Points) != 1 {
		t.Fatalf("expected 1 point, got %d", len(batch.Points))
	}
	p := batch.Points[0]
	if p.ValueDouble == nil || *p.ValueDouble != 0.5 || p.ValueInt != nil {
		t.Errorf("ValueDouble/ValueInt = %v/%v, want 0.5/nil", p.ValueDouble, p.ValueInt)
	}
	if p.Count != nil || p.Sum != nil || p.Min != nil || p.Max != nil {
		t.Errorf("Gauge point should have nil Count/Sum/Min/Max, got %+v", p)
	}
	if !p.TS.Equal(ts) {
		t.Errorf("TS = %v, want %v", p.TS, ts)
	}
	if p.StartTS != nil {
		t.Errorf("StartTS = %v, want nil (unset StartTimestamp)", p.StartTS)
	}
	if p.SeriesKey != series.SeriesKey {
		t.Error("point SeriesKey should match its series row")
	}
}

func TestConvertMetrics_SumCumulativeMonotonic(t *testing.T) {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName("requests.total")
	sum := m.SetEmptySum()
	sum.SetAggregationTemporality(pmetric.AggregationTemporalityCumulative)
	sum.SetIsMonotonic(true)
	dp := sum.DataPoints().AppendEmpty()
	dp.SetIntValue(42)
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	dp.SetStartTimestamp(pcommon.NewTimestampFromTime(start))
	dp.SetTimestamp(pcommon.NewTimestampFromTime(start.Add(time.Second)))

	batch := ConvertMetrics(md)
	if len(batch.Series) != 1 || len(batch.Points) != 1 {
		t.Fatalf("expected 1 series and 1 point, got %d/%d", len(batch.Series), len(batch.Points))
	}
	series := batch.Series[0]
	if series.Temporality != "cumulative" || !series.IsMonotonic {
		t.Errorf("Temporality/IsMonotonic = %q/%v, want cumulative/true", series.Temporality, series.IsMonotonic)
	}
	p := batch.Points[0]
	// Raw value stored as-is: no delta-ization at ingest (that moves to
	// query time), unlike the old store package's convertMetrics.
	if p.ValueInt == nil || *p.ValueInt != 42 || p.ValueDouble != nil {
		t.Errorf("ValueInt/ValueDouble = %v/%v, want the raw cumulative value 42/nil", p.ValueInt, p.ValueDouble)
	}
	if p.StartTS == nil || !p.StartTS.Equal(start) {
		t.Errorf("StartTS = %v, want %v", p.StartTS, start)
	}
}

func TestConvertMetrics_PreservesNonFiniteGaugeValues(t *testing.T) {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName("bad.metric")
	gauge := m.SetEmptyGauge()

	good := gauge.DataPoints().AppendEmpty()
	good.SetDoubleValue(1.0)
	good.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))

	nan := gauge.DataPoints().AppendEmpty()
	nan.SetDoubleValue(math.NaN())
	nan.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))

	inf := gauge.DataPoints().AppendEmpty()
	inf.SetDoubleValue(math.Inf(1))
	inf.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))

	batch := ConvertMetrics(md)
	if len(batch.Points) != 3 {
		t.Fatalf("expected all raw points to be retained, got %d points", len(batch.Points))
	}
	if *batch.Points[0].ValueDouble != 1.0 || !math.IsNaN(*batch.Points[1].ValueDouble) || !math.IsInf(*batch.Points[2].ValueDouble, 1) {
		t.Errorf("raw values = %v/%v/%v, want 1/NaN/+Inf", batch.Points[0].ValueDouble, batch.Points[1].ValueDouble, batch.Points[2].ValueDouble)
	}
}

func TestConvertMetrics_Histogram(t *testing.T) {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName("latency")
	hist := m.SetEmptyHistogram()
	hist.SetAggregationTemporality(pmetric.AggregationTemporalityDelta)
	dp := hist.DataPoints().AppendEmpty()
	dp.SetCount(10)
	dp.SetSum(55)
	dp.SetMin(1)
	dp.SetMax(20)
	dp.ExplicitBounds().FromRaw([]float64{5, 10})
	dp.BucketCounts().FromRaw([]uint64{2, 3, 5})
	dp.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))

	batch := ConvertMetrics(md)
	if len(batch.Series) != 1 {
		t.Fatalf("expected 1 series, got %d", len(batch.Series))
	}
	if batch.Series[0].Temporality != "delta" {
		t.Errorf("Temporality = %q, want delta", batch.Series[0].Temporality)
	}
	if len(batch.Points) != 1 {
		t.Fatalf("expected 1 point, got %d", len(batch.Points))
	}
	p := batch.Points[0]
	if p.ValueInt != nil || p.ValueDouble != nil {
		t.Errorf("Histogram point values should be nil, got %v/%v", p.ValueInt, p.ValueDouble)
	}
	if p.Count == nil || *p.Count != 10 {
		t.Errorf("Count = %v, want 10", p.Count)
	}
	if p.Sum == nil || *p.Sum != 55 {
		t.Errorf("Sum = %v, want 55", p.Sum)
	}
	if p.Min == nil || *p.Min != 1 || p.Max == nil || *p.Max != 20 {
		t.Errorf("Min/Max = %v/%v, want 1/20", p.Min, p.Max)
	}
	if len(batch.HistogramLayouts) != 1 || batch.HistogramLayouts[0].Kind != "explicit" {
		t.Fatalf("HistogramLayouts = %+v, want one explicit layout", batch.HistogramLayouts)
	}
	if p.HistogramLayoutHash == nil || *p.HistogramLayoutHash != batch.HistogramLayouts[0].LayoutHash {
		t.Errorf("point layout hash = %v, want %d", p.HistogramLayoutHash, batch.HistogramLayouts[0].LayoutHash)
	}
	if len(p.BucketCounts) != 3 || p.BucketCounts[1] != 3 {
		t.Errorf("BucketCounts = %v, want [2 3 5]", p.BucketCounts)
	}
}

func TestConvertMetrics_PreservesFlagsAndExemplars(t *testing.T) {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName("requests")
	dp := m.SetEmptyGauge().DataPoints().AppendEmpty()
	dp.SetIntValue(7)
	dp.SetFlags(pmetric.DefaultDataPointFlags.WithNoRecordedValue(true))
	dp.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	exemplar := dp.Exemplars().AppendEmpty()
	exemplar.SetIntValue(9_007_199_254_740_993)
	exemplar.SetTimestamp(dp.Timestamp())
	exemplar.SetTraceID(pcommon.TraceID{1})
	exemplar.SetSpanID(pcommon.SpanID{2})
	exemplar.FilteredAttributes().PutStr("sample", "kept")

	batch := ConvertMetrics(md)
	if len(batch.Points) != 1 || batch.Points[0].Flags != 1 {
		t.Fatalf("point flags = %v, want NoRecordedValue", batch.Points)
	}
	if len(batch.Exemplars) != 1 {
		t.Fatalf("exemplars = %d, want 1", len(batch.Exemplars))
	}
	got := batch.Exemplars[0]
	if got.PointID != batch.Points[0].ID || got.TraceID == "" || got.SpanID == "" {
		t.Errorf("exemplar correlation = %+v", got)
	}
	if got.ValueInt == nil || *got.ValueInt != 9_007_199_254_740_993 || got.ValueDouble != nil {
		t.Errorf("exemplar value = %v/%v", got.ValueInt, got.ValueDouble)
	}
	if got.FilteredAttributes["sample"] != "kept" {
		t.Errorf("filtered attributes = %v", got.FilteredAttributes)
	}
}

func TestConvertMetrics_PreservesSummaryQuantiles(t *testing.T) {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	sm := rm.ScopeMetrics().AppendEmpty()
	m := sm.Metrics().AppendEmpty()
	m.SetName("request.duration")
	dp := m.SetEmptySummary().DataPoints().AppendEmpty()
	dp.SetCount(20)
	dp.SetSum(100)
	dp.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	q50 := dp.QuantileValues().AppendEmpty()
	q50.SetQuantile(0.5)
	q50.SetValue(4)
	q99 := dp.QuantileValues().AppendEmpty()
	q99.SetQuantile(0.99)
	q99.SetValue(12)

	batch := ConvertMetrics(md)
	point := batch.Points[0]
	if !reflect.DeepEqual(point.SummaryQuantiles, []float64{0.5, 0.99}) ||
		!reflect.DeepEqual(point.SummaryQuantileValues, []float64{4, 12}) {
		t.Fatalf("summary quantiles = %v/%v", point.SummaryQuantiles, point.SummaryQuantileValues)
	}
}

func TestConvertMetrics_SeparatesIncompatibleDescriptors(t *testing.T) {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	sm := rm.ScopeMetrics().AppendEmpty()

	intGauge := sm.Metrics().AppendEmpty()
	intGauge.SetName("same.name")
	intGauge.SetUnit("1")
	intPoint := intGauge.SetEmptyGauge().DataPoints().AppendEmpty()
	intPoint.SetIntValue(1)
	intPoint.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))

	doubleGauge := sm.Metrics().AppendEmpty()
	doubleGauge.SetName("same.name")
	doubleGauge.SetUnit("ms")
	doublePoint := doubleGauge.SetEmptyGauge().DataPoints().AppendEmpty()
	doublePoint.SetDoubleValue(1)
	doublePoint.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))

	batch := ConvertMetrics(md)
	if len(batch.Series) != 2 || batch.Series[0].SeriesKey == batch.Series[1].SeriesKey {
		t.Fatalf("incompatible descriptors were merged: %+v", batch.Series)
	}
}

func TestConvertMetrics_DedupsSeriesWithinBatch(t *testing.T) {
	md := pmetric.NewMetrics()
	rm := md.ResourceMetrics().AppendEmpty()
	rm.Resource().Attributes().PutStr("service.name", "svc")

	// Two ScopeMetrics both reporting the same metric name/attrs: the
	// series metadata row must appear once, with two points.
	for i := 0; i < 2; i++ {
		sm := rm.ScopeMetrics().AppendEmpty()
		m := sm.Metrics().AppendEmpty()
		m.SetName("cpu.usage")
		dp := m.SetEmptyGauge().DataPoints().AppendEmpty()
		dp.SetDoubleValue(float64(i))
		dp.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	}

	batch := ConvertMetrics(md)
	if len(batch.Series) != 1 {
		t.Fatalf("expected series metadata deduped to 1 row, got %d", len(batch.Series))
	}
	if len(batch.Points) != 2 {
		t.Fatalf("expected 2 points, got %d", len(batch.Points))
	}
}

func TestConvertMetrics_SeparatesResourcesAndInstrumentationScopes(t *testing.T) {
	md := pmetric.NewMetrics()
	versions := []string{"1", "2"}
	for i, instanceID := range []string{"a", "b"} {
		rm := md.ResourceMetrics().AppendEmpty()
		rm.Resource().Attributes().PutStr("service.name", "svc")
		rm.Resource().Attributes().PutStr("service.instance.id", instanceID)
		sm := rm.ScopeMetrics().AppendEmpty()
		sm.Scope().SetName("scope")
		sm.Scope().SetVersion(versions[i])
		m := sm.Metrics().AppendEmpty()
		m.SetName("cpu.usage")
		dp := m.SetEmptyGauge().DataPoints().AppendEmpty()
		dp.SetDoubleValue(float64(i))
		dp.SetTimestamp(pcommon.NewTimestampFromTime(time.Now()))
	}

	batch := ConvertMetrics(md)
	if len(batch.Series) != 2 {
		t.Fatalf("expected independent resources/scopes to produce 2 series, got %d", len(batch.Series))
	}
	if batch.Series[0].SeriesKey == batch.Series[1].SeriesKey {
		t.Fatal("independent resources/scopes produced the same series key")
	}
}
