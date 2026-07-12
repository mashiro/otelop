/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  query InitialLoad {\n    config {\n      traceCount\n      metricCount\n      logCount\n    }\n    metrics(limit: 0) {\n      items {\n        name\n        description\n        unit\n        type\n        serviceName\n        resource\n        receivedAt\n        pointCount\n        latestValue\n      }\n    }\n  }\n": typeof types.InitialLoadDocument,
    "\n  query LogsPage($from: Time, $to: Time!, $after: String, $limit: Int!, $search: String) {\n    logs(from: $from, to: $to, after: $after, limit: $limit, search: $search) {\n      items {\n        id\n        timestamp\n        observedTimestamp\n        traceId\n        spanId\n        severityNumber\n        severityText\n        body\n        serviceName\n        attributes\n        resource\n      }\n      hasNextPage\n      endCursor\n    }\n  }\n": typeof types.LogsPageDocument,
    "\n  query MetricAggregate(\n    $serviceName: String!\n    $name: String!\n    $groupBy: [String!]!\n    $bucketSeconds: Int\n    $from: Time\n  ) {\n    metricAggregate(\n      serviceName: $serviceName\n      name: $name\n      groupBy: $groupBy\n      bucketSeconds: $bucketSeconds\n      from: $from\n    ) {\n      groupValues\n      points {\n        timestamp\n        value\n        count\n        sum\n        min\n        max\n      }\n    }\n  }\n": typeof types.MetricAggregateDocument,
    "\n  query MetricsList($search: String) {\n    metrics(limit: 0, search: $search) {\n      items {\n        name\n        serviceName\n      }\n    }\n  }\n": typeof types.MetricsListDocument,
    "\n  query MetricPoints($serviceName: String!, $name: String!, $from: Time) {\n    metricPoints(serviceName: $serviceName, name: $name, from: $from) {\n      id\n      timestamp\n      value\n      cumulative\n      count\n      countCumulative\n      sum\n      sumCumulative\n      min\n      max\n      attributes\n    }\n  }\n": typeof types.MetricPointsDocument,
    "\n  query ServiceMapSpans($from: Time, $to: Time!) {\n    traces(limit: 0, from: $from, to: $to) {\n      items {\n        traceId\n        spans {\n          ...SpanFields\n        }\n      }\n    }\n  }\n": typeof types.ServiceMapSpansDocument,
    "\n  query TracesPage($from: Time, $to: Time!, $after: String, $limit: Int!, $search: String) {\n    traces(from: $from, to: $to, after: $after, limit: $limit, search: $search) {\n      items {\n        traceId\n        serviceName\n        spanCount\n        startTime\n        durationMs\n        rootSpan {\n          name\n          kind\n          statusCode\n          durationMs\n        }\n      }\n      hasNextPage\n      endCursor\n    }\n  }\n": typeof types.TracesPageDocument,
    "\n  query TraceSpans($traceId: ID!) {\n    trace(traceId: $traceId) {\n      spans {\n        ...SpanFields\n      }\n    }\n  }\n": typeof types.TraceSpansDocument,
    "\n  fragment SpanFields on Span {\n    traceId\n    spanId\n    parentSpanId\n    name\n    kind\n    serviceName\n    startTime\n    endTime\n    durationMs\n    statusCode\n    statusMessage\n    attributes\n    events {\n      name\n      timestamp\n      attributes\n    }\n    resource\n  }\n": typeof types.SpanFieldsFragmentDoc,
};
const documents: Documents = {
    "\n  query InitialLoad {\n    config {\n      traceCount\n      metricCount\n      logCount\n    }\n    metrics(limit: 0) {\n      items {\n        name\n        description\n        unit\n        type\n        serviceName\n        resource\n        receivedAt\n        pointCount\n        latestValue\n      }\n    }\n  }\n": types.InitialLoadDocument,
    "\n  query LogsPage($from: Time, $to: Time!, $after: String, $limit: Int!, $search: String) {\n    logs(from: $from, to: $to, after: $after, limit: $limit, search: $search) {\n      items {\n        id\n        timestamp\n        observedTimestamp\n        traceId\n        spanId\n        severityNumber\n        severityText\n        body\n        serviceName\n        attributes\n        resource\n      }\n      hasNextPage\n      endCursor\n    }\n  }\n": types.LogsPageDocument,
    "\n  query MetricAggregate(\n    $serviceName: String!\n    $name: String!\n    $groupBy: [String!]!\n    $bucketSeconds: Int\n    $from: Time\n  ) {\n    metricAggregate(\n      serviceName: $serviceName\n      name: $name\n      groupBy: $groupBy\n      bucketSeconds: $bucketSeconds\n      from: $from\n    ) {\n      groupValues\n      points {\n        timestamp\n        value\n        count\n        sum\n        min\n        max\n      }\n    }\n  }\n": types.MetricAggregateDocument,
    "\n  query MetricsList($search: String) {\n    metrics(limit: 0, search: $search) {\n      items {\n        name\n        serviceName\n      }\n    }\n  }\n": types.MetricsListDocument,
    "\n  query MetricPoints($serviceName: String!, $name: String!, $from: Time) {\n    metricPoints(serviceName: $serviceName, name: $name, from: $from) {\n      id\n      timestamp\n      value\n      cumulative\n      count\n      countCumulative\n      sum\n      sumCumulative\n      min\n      max\n      attributes\n    }\n  }\n": types.MetricPointsDocument,
    "\n  query ServiceMapSpans($from: Time, $to: Time!) {\n    traces(limit: 0, from: $from, to: $to) {\n      items {\n        traceId\n        spans {\n          ...SpanFields\n        }\n      }\n    }\n  }\n": types.ServiceMapSpansDocument,
    "\n  query TracesPage($from: Time, $to: Time!, $after: String, $limit: Int!, $search: String) {\n    traces(from: $from, to: $to, after: $after, limit: $limit, search: $search) {\n      items {\n        traceId\n        serviceName\n        spanCount\n        startTime\n        durationMs\n        rootSpan {\n          name\n          kind\n          statusCode\n          durationMs\n        }\n      }\n      hasNextPage\n      endCursor\n    }\n  }\n": types.TracesPageDocument,
    "\n  query TraceSpans($traceId: ID!) {\n    trace(traceId: $traceId) {\n      spans {\n        ...SpanFields\n      }\n    }\n  }\n": types.TraceSpansDocument,
    "\n  fragment SpanFields on Span {\n    traceId\n    spanId\n    parentSpanId\n    name\n    kind\n    serviceName\n    startTime\n    endTime\n    durationMs\n    statusCode\n    statusMessage\n    attributes\n    events {\n      name\n      timestamp\n      attributes\n    }\n    resource\n  }\n": types.SpanFieldsFragmentDoc,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query InitialLoad {\n    config {\n      traceCount\n      metricCount\n      logCount\n    }\n    metrics(limit: 0) {\n      items {\n        name\n        description\n        unit\n        type\n        serviceName\n        resource\n        receivedAt\n        pointCount\n        latestValue\n      }\n    }\n  }\n"): (typeof documents)["\n  query InitialLoad {\n    config {\n      traceCount\n      metricCount\n      logCount\n    }\n    metrics(limit: 0) {\n      items {\n        name\n        description\n        unit\n        type\n        serviceName\n        resource\n        receivedAt\n        pointCount\n        latestValue\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query LogsPage($from: Time, $to: Time!, $after: String, $limit: Int!, $search: String) {\n    logs(from: $from, to: $to, after: $after, limit: $limit, search: $search) {\n      items {\n        id\n        timestamp\n        observedTimestamp\n        traceId\n        spanId\n        severityNumber\n        severityText\n        body\n        serviceName\n        attributes\n        resource\n      }\n      hasNextPage\n      endCursor\n    }\n  }\n"): (typeof documents)["\n  query LogsPage($from: Time, $to: Time!, $after: String, $limit: Int!, $search: String) {\n    logs(from: $from, to: $to, after: $after, limit: $limit, search: $search) {\n      items {\n        id\n        timestamp\n        observedTimestamp\n        traceId\n        spanId\n        severityNumber\n        severityText\n        body\n        serviceName\n        attributes\n        resource\n      }\n      hasNextPage\n      endCursor\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MetricAggregate(\n    $serviceName: String!\n    $name: String!\n    $groupBy: [String!]!\n    $bucketSeconds: Int\n    $from: Time\n  ) {\n    metricAggregate(\n      serviceName: $serviceName\n      name: $name\n      groupBy: $groupBy\n      bucketSeconds: $bucketSeconds\n      from: $from\n    ) {\n      groupValues\n      points {\n        timestamp\n        value\n        count\n        sum\n        min\n        max\n      }\n    }\n  }\n"): (typeof documents)["\n  query MetricAggregate(\n    $serviceName: String!\n    $name: String!\n    $groupBy: [String!]!\n    $bucketSeconds: Int\n    $from: Time\n  ) {\n    metricAggregate(\n      serviceName: $serviceName\n      name: $name\n      groupBy: $groupBy\n      bucketSeconds: $bucketSeconds\n      from: $from\n    ) {\n      groupValues\n      points {\n        timestamp\n        value\n        count\n        sum\n        min\n        max\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MetricsList($search: String) {\n    metrics(limit: 0, search: $search) {\n      items {\n        name\n        serviceName\n      }\n    }\n  }\n"): (typeof documents)["\n  query MetricsList($search: String) {\n    metrics(limit: 0, search: $search) {\n      items {\n        name\n        serviceName\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MetricPoints($serviceName: String!, $name: String!, $from: Time) {\n    metricPoints(serviceName: $serviceName, name: $name, from: $from) {\n      id\n      timestamp\n      value\n      cumulative\n      count\n      countCumulative\n      sum\n      sumCumulative\n      min\n      max\n      attributes\n    }\n  }\n"): (typeof documents)["\n  query MetricPoints($serviceName: String!, $name: String!, $from: Time) {\n    metricPoints(serviceName: $serviceName, name: $name, from: $from) {\n      id\n      timestamp\n      value\n      cumulative\n      count\n      countCumulative\n      sum\n      sumCumulative\n      min\n      max\n      attributes\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ServiceMapSpans($from: Time, $to: Time!) {\n    traces(limit: 0, from: $from, to: $to) {\n      items {\n        traceId\n        spans {\n          ...SpanFields\n        }\n      }\n    }\n  }\n"): (typeof documents)["\n  query ServiceMapSpans($from: Time, $to: Time!) {\n    traces(limit: 0, from: $from, to: $to) {\n      items {\n        traceId\n        spans {\n          ...SpanFields\n        }\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TracesPage($from: Time, $to: Time!, $after: String, $limit: Int!, $search: String) {\n    traces(from: $from, to: $to, after: $after, limit: $limit, search: $search) {\n      items {\n        traceId\n        serviceName\n        spanCount\n        startTime\n        durationMs\n        rootSpan {\n          name\n          kind\n          statusCode\n          durationMs\n        }\n      }\n      hasNextPage\n      endCursor\n    }\n  }\n"): (typeof documents)["\n  query TracesPage($from: Time, $to: Time!, $after: String, $limit: Int!, $search: String) {\n    traces(from: $from, to: $to, after: $after, limit: $limit, search: $search) {\n      items {\n        traceId\n        serviceName\n        spanCount\n        startTime\n        durationMs\n        rootSpan {\n          name\n          kind\n          statusCode\n          durationMs\n        }\n      }\n      hasNextPage\n      endCursor\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TraceSpans($traceId: ID!) {\n    trace(traceId: $traceId) {\n      spans {\n        ...SpanFields\n      }\n    }\n  }\n"): (typeof documents)["\n  query TraceSpans($traceId: ID!) {\n    trace(traceId: $traceId) {\n      spans {\n        ...SpanFields\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment SpanFields on Span {\n    traceId\n    spanId\n    parentSpanId\n    name\n    kind\n    serviceName\n    startTime\n    endTime\n    durationMs\n    statusCode\n    statusMessage\n    attributes\n    events {\n      name\n      timestamp\n      attributes\n    }\n    resource\n  }\n"): (typeof documents)["\n  fragment SpanFields on Span {\n    traceId\n    spanId\n    parentSpanId\n    name\n    kind\n    serviceName\n    startTime\n    endTime\n    durationMs\n    statusCode\n    statusMessage\n    attributes\n    events {\n      name\n      timestamp\n      attributes\n    }\n    resource\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;