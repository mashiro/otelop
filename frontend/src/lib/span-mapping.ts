import { graphql } from "@/gql";
import type { SpanFieldsFragment } from "@/gql/graphql";
import type { SpanData, SpanStatus } from "@/types/telemetry";
import { normalizeSpan } from "@/lib/normalize";

// GraphQL reports span duration as durationMs; SpanData's `duration` field is
// nanosecond-precision (matching the OTel wire format internal/broadcast
// sends over the WebSocket), so a GraphQL-fetched span and a WS-delivered one
// carry the same unit once converted here.
export const MS_TO_NS = 1_000_000;

// Full field set used by the trace-detail span query. Keeping it as a fragment
// gives graphql-codegen a reusable mapping type for the response.
export const SpanFieldsFragmentDoc = graphql(`
  fragment SpanFields on Span {
    traceId
    spanId
    parentSpanId
    name
    kind
    serviceName
    startTime
    endTime
    durationMs
    statusCode
    statusMessage
    attributes
    events {
      name
      timestamp
      attributes
    }
    resource
  }
`);

export function toSpan({ durationMs, statusCode, ...rest }: SpanFieldsFragment): SpanData {
  return normalizeSpan({
    ...rest,
    statusCode: statusCode as SpanStatus,
    duration: durationMs * MS_TO_NS,
  });
}
