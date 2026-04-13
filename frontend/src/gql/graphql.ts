/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  JSON: { input: Record<string, unknown>; output: Record<string, unknown>; }
  Time: { input: string; output: string; }
};

export type Config = {
  __typename?: 'Config';
  logCap: Scalars['Int']['output'];
  logCount: Scalars['Int']['output'];
  maxDataPoints: Scalars['Int']['output'];
  metricCap: Scalars['Int']['output'];
  metricCount: Scalars['Int']['output'];
  traceCap: Scalars['Int']['output'];
  traceCount: Scalars['Int']['output'];
};

/**
 * One point in a metric's series. For cumulative OTLP inputs (monotonic Sum,
 * Histogram, Summary, ExponentialHistogram) the server delta-izes against the
 * previous observation before returning, so the fields below describe
 * per-interval activity, not running totals.
 */
export type DataPoint = {
  __typename?: 'DataPoint';
  attributes: Scalars['JSON']['output'];
  /** Delta observation count for distribution metrics. Null for Gauge/Sum. */
  count?: Maybe<Scalars['Float']['output']>;
  /** Maximum observation in this window, as reported by the SDK. Null when unavailable. */
  max?: Maybe<Scalars['Float']['output']>;
  /** Minimum observation in this window, as reported by the SDK. Null when unavailable. */
  min?: Maybe<Scalars['Float']['output']>;
  /** Delta of observation sums for distribution metrics. Null for Gauge/Sum. */
  sum?: Maybe<Scalars['Float']['output']>;
  timestamp: Scalars['Time']['output'];
  /**
   * The primary scalar for this point. Gauge: instantaneous value. Sum: per-window
   * delta. Histogram / Summary / ExponentialHistogram: per-window arithmetic mean
   * (sum / count) so the metric's declared unit applies directly.
   */
  value: Scalars['Float']['output'];
};

export type Log = {
  __typename?: 'Log';
  attributes: Scalars['JSON']['output'];
  body: Scalars['String']['output'];
  observedTimestamp: Scalars['Time']['output'];
  resource: Scalars['JSON']['output'];
  serviceName: Scalars['String']['output'];
  severityNumber: Scalars['Int']['output'];
  severityText: Scalars['String']['output'];
  /** Correlated span within the trace, or null if traceId/spanId are unset or the trace/span is missing. */
  span?: Maybe<Span>;
  spanId: Scalars['String']['output'];
  timestamp: Scalars['Time']['output'];
  /** Correlated trace, or null if the log has no traceId or the trace has been evicted from the ring buffer. */
  trace?: Maybe<Trace>;
  traceId: Scalars['String']['output'];
};

export type LogConnection = {
  __typename?: 'LogConnection';
  items: Array<Log>;
  limit: Scalars['Int']['output'];
  offset: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type Metric = {
  __typename?: 'Metric';
  dataPoints: Array<DataPoint>;
  description: Scalars['String']['output'];
  name: Scalars['String']['output'];
  /** Length of dataPoints without requesting the array. */
  pointCount: Scalars['Int']['output'];
  receivedAt: Scalars['Time']['output'];
  resource: Scalars['JSON']['output'];
  serviceName: Scalars['String']['output'];
  type: Scalars['String']['output'];
  unit: Scalars['String']['output'];
};

export type MetricConnection = {
  __typename?: 'MetricConnection';
  items: Array<Metric>;
  limit: Scalars['Int']['output'];
  offset: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  /** Drop every buffered trace, metric, and log. */
  clearSignals: Scalars['Boolean']['output'];
};

export type Query = {
  __typename?: 'Query';
  /** Ring buffer capacity and current counts. */
  config: Config;
  /**
   * List log records newest-first. If traceId is given, only logs whose TraceID
   * matches are returned — the standard observability trace↔log correlation.
   */
  logs: LogConnection;
  /** List metrics newest-first. */
  metrics: MetricConnection;
  /** Runtime info for the running otelop instance. Consumed by `otelop status`. */
  status: Status;
  /** Fetch a single trace by its hex-encoded trace ID. */
  trace?: Maybe<Trace>;
  /** List traces newest-first. */
  traces: TraceConnection;
};


export type QueryLogsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
  traceId?: InputMaybe<Scalars['String']['input']>;
};


export type QueryMetricsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryTraceArgs = {
  traceId: Scalars['ID']['input'];
};


export type QueryTracesArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  offset?: InputMaybe<Scalars['Int']['input']>;
};

export type Span = {
  __typename?: 'Span';
  attributes: Scalars['JSON']['output'];
  /** Span duration in milliseconds. */
  durationMs: Scalars['Float']['output'];
  endTime: Scalars['Time']['output'];
  events: Array<SpanEvent>;
  kind: Scalars['String']['output'];
  name: Scalars['String']['output'];
  /** Parent span within the same trace, if any. Null for root spans. */
  parent?: Maybe<Span>;
  parentSpanId: Scalars['String']['output'];
  resource: Scalars['JSON']['output'];
  serviceName: Scalars['String']['output'];
  spanId: Scalars['ID']['output'];
  startTime: Scalars['Time']['output'];
  statusCode: Scalars['String']['output'];
  statusMessage: Scalars['String']['output'];
  /** Parent trace. Always present because spans are only returned via a trace. */
  trace: Trace;
  traceId: Scalars['ID']['output'];
};

export type SpanEvent = {
  __typename?: 'SpanEvent';
  attributes: Scalars['JSON']['output'];
  name: Scalars['String']['output'];
  timestamp: Scalars['Time']['output'];
};

export type Status = {
  __typename?: 'Status';
  /** Ring buffer capacity and current counts. */
  config: Config;
  /** True when self-telemetry is enabled via --debug. */
  debug: Scalars['Boolean']['output'];
  /** HTTP / Web UI listen address as passed on the command line. */
  httpAddr: Scalars['String']['output'];
  /** OTLP gRPC receiver listen address. */
  otlpGrpcAddr: Scalars['String']['output'];
  /** OTLP HTTP receiver listen address. */
  otlpHttpAddr: Scalars['String']['output'];
  /** Server start time (RFC3339). */
  startedAt: Scalars['Time']['output'];
  /** Milliseconds since the server started. */
  uptimeMs: Scalars['Float']['output'];
  version: Scalars['String']['output'];
};

export type Trace = {
  __typename?: 'Trace';
  /** Total trace duration in milliseconds. */
  durationMs: Scalars['Float']['output'];
  /** True if any span under the trace has StatusCode='Error'. */
  hasError: Scalars['Boolean']['output'];
  /** Log records whose TraceID matches this trace — correlation join. */
  logs: Array<Log>;
  rootSpan?: Maybe<Span>;
  serviceName: Scalars['String']['output'];
  spanCount: Scalars['Int']['output'];
  /** Every span otelop has buffered under this trace. */
  spans: Array<Span>;
  startTime: Scalars['Time']['output'];
  traceId: Scalars['ID']['output'];
};

export type TraceConnection = {
  __typename?: 'TraceConnection';
  items: Array<Trace>;
  limit: Scalars['Int']['output'];
  offset: Scalars['Int']['output'];
  total: Scalars['Int']['output'];
};

export type ClearSignalsMutationVariables = Exact<{ [key: string]: never; }>;


export type ClearSignalsMutation = { __typename?: 'Mutation', clearSignals: boolean };

export type InitialLoadQueryVariables = Exact<{ [key: string]: never; }>;


export type InitialLoadQuery = { __typename?: 'Query', config: { __typename?: 'Config', traceCap: number, metricCap: number, logCap: number, maxDataPoints: number }, traces: { __typename?: 'TraceConnection', items: Array<{ __typename?: 'Trace', traceId: string, serviceName: string, spanCount: number, startTime: string, durationMs: number, spans: Array<{ __typename?: 'Span', traceId: string, spanId: string, parentSpanId: string, name: string, kind: string, serviceName: string, startTime: string, endTime: string, durationMs: number, statusCode: string, statusMessage: string, attributes: Record<string, unknown>, resource: Record<string, unknown>, events: Array<{ __typename?: 'SpanEvent', name: string, timestamp: string, attributes: Record<string, unknown> }> }> }> }, metrics: { __typename?: 'MetricConnection', items: Array<{ __typename?: 'Metric', name: string, description: string, unit: string, type: string, serviceName: string, resource: Record<string, unknown>, receivedAt: string, dataPoints: Array<{ __typename?: 'DataPoint', timestamp: string, value: number, count?: number | null, sum?: number | null, min?: number | null, max?: number | null, attributes: Record<string, unknown> }> }> }, logs: { __typename?: 'LogConnection', items: Array<{ __typename?: 'Log', timestamp: string, observedTimestamp: string, traceId: string, spanId: string, severityNumber: number, severityText: string, body: string, serviceName: string, attributes: Record<string, unknown>, resource: Record<string, unknown> }> } };

export type SpanFieldsFragment = { __typename?: 'Span', traceId: string, spanId: string, parentSpanId: string, name: string, kind: string, serviceName: string, startTime: string, endTime: string, durationMs: number, statusCode: string, statusMessage: string, attributes: Record<string, unknown>, resource: Record<string, unknown>, events: Array<{ __typename?: 'SpanEvent', name: string, timestamp: string, attributes: Record<string, unknown> }> };

export const SpanFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SpanFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Span"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"traceId"}},{"kind":"Field","name":{"kind":"Name","value":"spanId"}},{"kind":"Field","name":{"kind":"Name","value":"parentSpanId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"serviceName"}},{"kind":"Field","name":{"kind":"Name","value":"startTime"}},{"kind":"Field","name":{"kind":"Name","value":"endTime"}},{"kind":"Field","name":{"kind":"Name","value":"durationMs"}},{"kind":"Field","name":{"kind":"Name","value":"statusCode"}},{"kind":"Field","name":{"kind":"Name","value":"statusMessage"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"}},{"kind":"Field","name":{"kind":"Name","value":"events"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"resource"}}]}}]} as unknown as DocumentNode<SpanFieldsFragment, unknown>;
export const ClearSignalsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ClearSignals"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"clearSignals"}}]}}]} as unknown as DocumentNode<ClearSignalsMutation, ClearSignalsMutationVariables>;
export const InitialLoadDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"InitialLoad"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"config"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"traceCap"}},{"kind":"Field","name":{"kind":"Name","value":"metricCap"}},{"kind":"Field","name":{"kind":"Name","value":"logCap"}},{"kind":"Field","name":{"kind":"Name","value":"maxDataPoints"}}]}},{"kind":"Field","name":{"kind":"Name","value":"traces"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"0"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"traceId"}},{"kind":"Field","name":{"kind":"Name","value":"serviceName"}},{"kind":"Field","name":{"kind":"Name","value":"spanCount"}},{"kind":"Field","name":{"kind":"Name","value":"startTime"}},{"kind":"Field","name":{"kind":"Name","value":"durationMs"}},{"kind":"Field","name":{"kind":"Name","value":"spans"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"SpanFields"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"metrics"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"0"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"unit"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"serviceName"}},{"kind":"Field","name":{"kind":"Name","value":"resource"}},{"kind":"Field","name":{"kind":"Name","value":"receivedAt"}},{"kind":"Field","name":{"kind":"Name","value":"dataPoints"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"value"}},{"kind":"Field","name":{"kind":"Name","value":"count"}},{"kind":"Field","name":{"kind":"Name","value":"sum"}},{"kind":"Field","name":{"kind":"Name","value":"min"}},{"kind":"Field","name":{"kind":"Name","value":"max"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"logs"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"limit"},"value":{"kind":"IntValue","value":"0"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"observedTimestamp"}},{"kind":"Field","name":{"kind":"Name","value":"traceId"}},{"kind":"Field","name":{"kind":"Name","value":"spanId"}},{"kind":"Field","name":{"kind":"Name","value":"severityNumber"}},{"kind":"Field","name":{"kind":"Name","value":"severityText"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"serviceName"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"}},{"kind":"Field","name":{"kind":"Name","value":"resource"}}]}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"SpanFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Span"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"traceId"}},{"kind":"Field","name":{"kind":"Name","value":"spanId"}},{"kind":"Field","name":{"kind":"Name","value":"parentSpanId"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"serviceName"}},{"kind":"Field","name":{"kind":"Name","value":"startTime"}},{"kind":"Field","name":{"kind":"Name","value":"endTime"}},{"kind":"Field","name":{"kind":"Name","value":"durationMs"}},{"kind":"Field","name":{"kind":"Name","value":"statusCode"}},{"kind":"Field","name":{"kind":"Name","value":"statusMessage"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"}},{"kind":"Field","name":{"kind":"Name","value":"events"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"timestamp"}},{"kind":"Field","name":{"kind":"Name","value":"attributes"}}]}},{"kind":"Field","name":{"kind":"Name","value":"resource"}}]}}]} as unknown as DocumentNode<InitialLoadQuery, InitialLoadQueryVariables>;