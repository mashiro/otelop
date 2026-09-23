import type { SpanData, TraceData, LogData, MetricData, DataPoint } from "@/types/telemetry";
import type { AggregatePointData, AggregateSeriesData } from "@/hooks/use-metric-aggregate-series";
import type { ServerInfoQuery } from "@/gql/graphql";
import {
  normalizeSpan,
  normalizeTrace,
  normalizeLog,
  normalizeDataPoint,
  normalizeMetric,
} from "@/lib/normalize";

// A convenient row count for list-rendering tests to set
// stores/telemetry.ts's renderWindowMaxAtom to and build fixture lists
// against — not tied to the backend's configurable default value, just a
// round number comfortably larger than any test's assertions need.
export const TEST_RENDER_WINDOW_MAX = 500;

// Every factory below builds its wire-shaped defaults, merges in overrides,
// then runs the result through lib/normalize.ts's normalize* function — the
// same function every real ingest entry point uses — so a test can never
// construct a record with a stale/missing epoch field, and overriding
// startTime/timestamp always re-derives the matching epoch automatically.
export function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  return normalizeSpan({
    traceId: "t1",
    spanId: "s1",
    parentSpanId: "",
    name: "GET /api",
    kind: "Server",
    serviceName: "frontend",
    startTime: "2024-01-01T00:00:00Z",
    endTime: "2024-01-01T00:00:01Z",
    duration: 1_000_000,
    statusCode: "Ok",
    statusMessage: "",
    attributes: {},
    events: [],
    resource: {},
    ...overrides,
  });
}

// Converts a makeSpan()-shaped SpanData back into the GraphQL SpanFields
// fragment shape (durationMs instead of duration) a mocked gqlClient.request
// response needs — the inverse of lib/span-mapping.ts's toSpan.
export function toQuerySpan(span: SpanData) {
  const { duration, startEpochNs: _startEpochNs, endEpochNs: _endEpochNs, ...rest } = span;
  return { ...rest, durationMs: duration / 1_000_000 };
}

export function makeTrace(overrides: Partial<TraceData> = {}): TraceData {
  return normalizeTrace({
    traceId: "t1",
    spans: [makeSpan()],
    spanCount: 1,
    serviceName: "frontend",
    startTime: "2024-01-01T00:00:00Z",
    duration: 1_000_000,
    ...overrides,
  });
}

export function makeLog(overrides: Partial<LogData> = {}): LogData {
  return normalizeLog({
    id: "log-1",
    timestamp: "2024-01-01T00:00:00Z",
    observedTimestamp: "2024-01-01T00:00:00Z",
    severityNumber: 9,
    severityText: "INFO",
    body: "request handled",
    traceId: "",
    spanId: "",
    serviceName: "frontend",
    attributes: {},
    resource: {},
    ...overrides,
  });
}

export function makeDataPoint(overrides: Partial<DataPoint> = {}): DataPoint {
  return normalizeDataPoint({
    id: "dp-1",
    seriesKey: "series-1",
    timestamp: "2024-01-01T00:00:00Z",
    value: 0,
    attributes: {},
    ...overrides,
  });
}

export function makeMetric(overrides: Partial<MetricData> = {}): MetricData {
  return normalizeMetric({
    name: "http.requests",
    type: "Sum",
    unit: "",
    description: "",
    serviceName: "frontend",
    resource: {},
    dataPoints: [],
    pointCount: 0,
    latestValue: null,
    receivedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  });
}

export function makeAggregatePoint(
  overrides: Partial<AggregatePointData> = {},
): AggregatePointData {
  return {
    timestamp: "2024-01-01T00:00:00Z",
    value: 0,
    count: null,
    sum: null,
    min: null,
    max: null,
    ...overrides,
  };
}

export function makeAggregateSeries(
  overrides: Partial<AggregateSeriesData> = {},
): AggregateSeriesData {
  return {
    groupValues: ["a"],
    points: [makeAggregatePoint()],
    ...overrides,
  };
}

// Mocked gqlClient.request response shape for use-server-info.ts's ServerInfoQuery.
export function makeServerInfoResponse(
  overrides: {
    status?: Partial<ServerInfoQuery["status"]>;
    storage?: Partial<ServerInfoQuery["status"]["storage"]>;
    lastSweep?: ServerInfoQuery["status"]["storage"]["lastSweep"];
  } = {},
): ServerInfoQuery {
  const storage = {
    fileSizeBytes: 1_048_576,
    walSizeBytes: 4_096,
    databaseSizeBytes: 2_097_152,
    totalBlocks: 128,
    usedBlocks: 64,
    freeBlocks: 64,
    memoryUsageBytes: 8_388_608,
    memoryLimitBytes: 536_870_912,
    tempStorageBytes: 0,
    maxSizeBytes: 4_294_967_296,
    retentionMs: 604_800_000,
    tables: [
      { name: "resources", rows: 3 },
      { name: "metric_series", rows: 5 },
      { name: "spans", rows: 120 },
      { name: "metric_points", rows: 900 },
      { name: "logs", rows: 42 },
    ],
    oldestTimestamp: "2024-01-01T00:00:00Z",
    newestTimestamp: "2024-01-02T00:00:00Z",
    sweepIntervalMs: 3_600_000,
    nextSweepAt: "2024-01-02T01:00:00Z",
    lastSweep: overrides.lastSweep ?? null,
    ...overrides.storage,
  };
  return {
    status: {
      version: "v1.2.3",
      startedAt: "2024-01-01T00:00:00Z",
      uptimeMs: 3_600_000,
      httpAddr: ":4319",
      otlpGrpcAddr: "0.0.0.0:4317",
      otlpHttpAddr: "0.0.0.0:4318",
      proxyUrl: "",
      proxyProtocol: "",
      debug: false,
      logLevel: "warn",
      config: {
        storagePath: "/tmp/otelop.duckdb",
        retention: "7d",
        maxSize: "4GB",
        traceCount: 10,
        metricCount: 2,
        logCount: 40,
      },
      storage,
      ...overrides.status,
    },
  };
}

// Real-world-magnitude values (millions of rows, a GB-scale database, a
// long path and error message) for the dialog's overlap/overflow tests.
export function makeLargeServerInfoResponse(): ServerInfoQuery {
  const longPath =
    "/var/folders/dx/nrqfyl811vv5504krhcv4r_r0000gn/T/some-really-long-directory-name-that-keeps-going/otelop-production-instance/otelop.duckdb";
  return makeServerInfoResponse({
    status: {
      config: {
        storagePath: longPath,
        retention: "30d",
        maxSize: "4GB",
        traceCount: 168_248,
        metricCount: 178,
        logCount: 3_028_393,
      },
    },
    storage: {
      fileSizeBytes: 1_320_000_000,
      maxSizeBytes: 4_000_000_000,
      walSizeBytes: 12_582_912,
      usedBlocks: 322_048,
      freeBlocks: 1_024,
      memoryUsageBytes: 268_435_456,
      memoryLimitBytes: 1_073_741_824,
      tempStorageBytes: 5_242_880,
      tables: [
        { name: "resources", rows: 4_211 },
        { name: "metric_series", rows: 9_842 },
        { name: "spans", rows: 3_028_393 },
        { name: "metric_points", rows: 12_884_901 },
        { name: "logs", rows: 3_028_393 },
      ],
    },
    lastSweep: {
      startedAt: new Date(Date.now() - 65_000).toISOString(),
      durationMs: 45_231,
      deletedRows: 982_113,
      maxSizeIterations: 3,
      error:
        "storage: checkpoint: disk full: no space left on device while writing write-ahead log segment 00000482",
    },
  });
}
