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
    "\n  mutation ClearSignals {\n    clearSignals\n  }\n": typeof types.ClearSignalsDocument,
    "\n  query InitialLoad {\n    config {\n      traceCap\n      metricCap\n      logCap\n      maxDataPoints\n    }\n    traces(limit: 0) {\n      items {\n        traceId\n        serviceName\n        spanCount\n        startTime\n        durationMs\n        spans {\n          ...SpanFields\n        }\n      }\n    }\n    metrics(limit: 0) {\n      items {\n        name\n        description\n        unit\n        type\n        serviceName\n        resource\n        receivedAt\n        dataPoints {\n          timestamp\n          value\n          count\n          sum\n          min\n          max\n          attributes\n        }\n      }\n    }\n    logs(limit: 0) {\n      items {\n        timestamp\n        observedTimestamp\n        traceId\n        spanId\n        severityNumber\n        severityText\n        body\n        serviceName\n        attributes\n        resource\n      }\n    }\n  }\n\n  fragment SpanFields on Span {\n    traceId\n    spanId\n    parentSpanId\n    name\n    kind\n    serviceName\n    startTime\n    endTime\n    durationMs\n    statusCode\n    statusMessage\n    attributes\n    events {\n      name\n      timestamp\n      attributes\n    }\n    resource\n  }\n": typeof types.InitialLoadDocument,
};
const documents: Documents = {
    "\n  mutation ClearSignals {\n    clearSignals\n  }\n": types.ClearSignalsDocument,
    "\n  query InitialLoad {\n    config {\n      traceCap\n      metricCap\n      logCap\n      maxDataPoints\n    }\n    traces(limit: 0) {\n      items {\n        traceId\n        serviceName\n        spanCount\n        startTime\n        durationMs\n        spans {\n          ...SpanFields\n        }\n      }\n    }\n    metrics(limit: 0) {\n      items {\n        name\n        description\n        unit\n        type\n        serviceName\n        resource\n        receivedAt\n        dataPoints {\n          timestamp\n          value\n          count\n          sum\n          min\n          max\n          attributes\n        }\n      }\n    }\n    logs(limit: 0) {\n      items {\n        timestamp\n        observedTimestamp\n        traceId\n        spanId\n        severityNumber\n        severityText\n        body\n        serviceName\n        attributes\n        resource\n      }\n    }\n  }\n\n  fragment SpanFields on Span {\n    traceId\n    spanId\n    parentSpanId\n    name\n    kind\n    serviceName\n    startTime\n    endTime\n    durationMs\n    statusCode\n    statusMessage\n    attributes\n    events {\n      name\n      timestamp\n      attributes\n    }\n    resource\n  }\n": types.InitialLoadDocument,
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
export function graphql(source: "\n  mutation ClearSignals {\n    clearSignals\n  }\n"): (typeof documents)["\n  mutation ClearSignals {\n    clearSignals\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query InitialLoad {\n    config {\n      traceCap\n      metricCap\n      logCap\n      maxDataPoints\n    }\n    traces(limit: 0) {\n      items {\n        traceId\n        serviceName\n        spanCount\n        startTime\n        durationMs\n        spans {\n          ...SpanFields\n        }\n      }\n    }\n    metrics(limit: 0) {\n      items {\n        name\n        description\n        unit\n        type\n        serviceName\n        resource\n        receivedAt\n        dataPoints {\n          timestamp\n          value\n          count\n          sum\n          min\n          max\n          attributes\n        }\n      }\n    }\n    logs(limit: 0) {\n      items {\n        timestamp\n        observedTimestamp\n        traceId\n        spanId\n        severityNumber\n        severityText\n        body\n        serviceName\n        attributes\n        resource\n      }\n    }\n  }\n\n  fragment SpanFields on Span {\n    traceId\n    spanId\n    parentSpanId\n    name\n    kind\n    serviceName\n    startTime\n    endTime\n    durationMs\n    statusCode\n    statusMessage\n    attributes\n    events {\n      name\n      timestamp\n      attributes\n    }\n    resource\n  }\n"): (typeof documents)["\n  query InitialLoad {\n    config {\n      traceCap\n      metricCap\n      logCap\n      maxDataPoints\n    }\n    traces(limit: 0) {\n      items {\n        traceId\n        serviceName\n        spanCount\n        startTime\n        durationMs\n        spans {\n          ...SpanFields\n        }\n      }\n    }\n    metrics(limit: 0) {\n      items {\n        name\n        description\n        unit\n        type\n        serviceName\n        resource\n        receivedAt\n        dataPoints {\n          timestamp\n          value\n          count\n          sum\n          min\n          max\n          attributes\n        }\n      }\n    }\n    logs(limit: 0) {\n      items {\n        timestamp\n        observedTimestamp\n        traceId\n        spanId\n        severityNumber\n        severityText\n        body\n        serviceName\n        attributes\n        resource\n      }\n    }\n  }\n\n  fragment SpanFields on Span {\n    traceId\n    spanId\n    parentSpanId\n    name\n    kind\n    serviceName\n    startTime\n    endTime\n    durationMs\n    statusCode\n    statusMessage\n    attributes\n    events {\n      name\n      timestamp\n      attributes\n    }\n    resource\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;