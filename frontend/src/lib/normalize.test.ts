import { describe, it, expect } from "vite-plus/test";
import {
  parseEpochNs,
  normalizeSpan,
  normalizeTrace,
  normalizeDataPoint,
  normalizeMetric,
  normalizeLog,
} from "./normalize";
import type {
  SpanDataWire,
  TraceDataWire,
  DataPointWire,
  MetricDataWire,
  LogDataWire,
} from "@/types/telemetry";

describe("parseEpochNs", () => {
  it("preserves full nanosecond precision (not truncated to milliseconds)", () => {
    expect(parseEpochNs("2024-01-01T00:00:00.123456789Z")).toBe(1704067200123456789n);
  });

  it("round-trips back to the same instant", () => {
    const iso = "2024-06-15T12:34:56.987654321Z";
    const ns = parseEpochNs(iso);
    expect(new Date(Number(ns / 1_000_000n)).toISOString()).toBe("2024-06-15T12:34:56.987Z");
    expect(ns % 1_000_000n).toBe(987654321n % 1_000_000n);
  });

  it("distinguishes two instants that differ only in sub-millisecond precision", () => {
    const a = parseEpochNs("2024-01-01T00:00:00.000000001Z");
    const b = parseEpochNs("2024-01-01T00:00:00.000000002Z");
    expect(a).not.toBe(b);
    expect(b - a).toBe(1n);
  });
});

function makeSpanWire(overrides: Partial<SpanDataWire> = {}): SpanDataWire {
  return {
    traceId: "t1",
    spanId: "s1",
    parentSpanId: "",
    name: "GET /api",
    kind: "Server",
    serviceName: "frontend",
    startTime: "2024-01-01T00:00:00.111111111Z",
    endTime: "2024-01-01T00:00:01.222222222Z",
    duration: 1_000_000,
    statusCode: "Ok",
    statusMessage: "",
    attributes: {},
    events: [],
    resource: {},
    ...overrides,
  };
}

describe("normalizeSpan", () => {
  it("attaches ns-precision startEpochNs/endEpochNs derived from startTime/endTime", () => {
    const span = normalizeSpan(makeSpanWire());
    expect(span.startEpochNs).toBe(parseEpochNs("2024-01-01T00:00:00.111111111Z"));
    expect(span.endEpochNs).toBe(parseEpochNs("2024-01-01T00:00:01.222222222Z"));
  });

  it("preserves every wire field unchanged", () => {
    const wire = makeSpanWire();
    const span = normalizeSpan(wire);
    expect(span).toMatchObject(wire);
  });
});

function makeTraceWire(overrides: Partial<TraceDataWire> = {}): TraceDataWire {
  return {
    traceId: "t1",
    spans: [],
    serviceName: "frontend",
    spanCount: 1,
    startTime: "2024-01-01T00:00:00.500000000Z",
    duration: 1_000_000,
    ...overrides,
  };
}

describe("normalizeTrace", () => {
  it("attaches startEpochNs derived from startTime", () => {
    const trace = normalizeTrace(makeTraceWire());
    expect(trace.startEpochNs).toBe(parseEpochNs("2024-01-01T00:00:00.500000000Z"));
  });

  it("normalizes every nested span too", () => {
    const trace = normalizeTrace(makeTraceWire({ spans: [makeSpanWire({ spanId: "a" })] }));
    expect(trace.spans[0]?.startEpochNs).toBe(parseEpochNs(trace.spans[0]!.startTime));
  });
});

function makeDataPointWire(overrides: Partial<DataPointWire> = {}): DataPointWire {
  return {
    id: "dp-1",
    seriesKey: "series-1",
    timestamp: "2024-01-01T00:00:00.999999999Z",
    value: 1,
    attributes: {},
    ...overrides,
  };
}

describe("normalizeDataPoint", () => {
  it("attaches ns-precision epochNs derived from timestamp", () => {
    const dp = normalizeDataPoint(makeDataPointWire());
    expect(dp.epochNs).toBe(parseEpochNs("2024-01-01T00:00:00.999999999Z"));
  });
});

describe("normalizeMetric", () => {
  it("normalizes every data point in the wire metric's dataPoints array", () => {
    const wire: MetricDataWire = {
      name: "http.requests",
      description: "",
      unit: "",
      type: "Sum",
      serviceName: "frontend",
      resource: {},
      dataPoints: [makeDataPointWire({ id: "a" }), makeDataPointWire({ id: "b" })],
      pointCount: 2,
      latestValue: 1,
      receivedAt: "2024-01-01T00:00:00Z",
    };

    const metric = normalizeMetric(wire);

    expect(metric.dataPoints.map((p) => p.id)).toEqual(["a", "b"]);
    expect(metric.dataPoints.every((p) => typeof p.epochNs === "bigint")).toBe(true);
  });
});

describe("normalizeLog", () => {
  it("attaches ns-precision epochNs derived from timestamp", () => {
    const wire: LogDataWire = {
      id: "log-1",
      timestamp: "2024-01-01T00:00:00.333333333Z",
      observedTimestamp: "2024-01-01T00:00:00.333333333Z",
      traceId: "",
      spanId: "",
      severityNumber: 9,
      severityText: "INFO",
      body: "hello",
      serviceName: "frontend",
      attributes: {},
      resource: {},
    };

    const log = normalizeLog(wire);

    expect(log.epochNs).toBe(parseEpochNs("2024-01-01T00:00:00.333333333Z"));
  });
});
