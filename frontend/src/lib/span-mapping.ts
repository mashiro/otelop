import { graphql } from "@/gql";
import type { SpanFieldsFragment } from "@/gql/graphql";
import type { SpanData, SpanStatus } from "@/types/telemetry";

// GraphQL reports span duration as durationMs; SpanData's `duration` field is
// nanosecond-precision (matching the OTel wire format internal/broadcast
// sends over the WebSocket), so a GraphQL-fetched span and a WS-delivered one
// carry the same unit once converted here.
export const MS_TO_NS = 1_000_000;

// Shared by every query that needs a span's full field set
// (hooks/use-trace-spans.ts, hooks/use-service-map-spans.ts) so the field
// list can't drift between them — graphql-codegen resolves this fragment
// wherever a document spreads `...SpanFields`, regardless of which file
// defines it (see codegen.ts's `documents` glob).
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
  return { ...rest, statusCode: statusCode as SpanStatus, duration: durationMs * MS_TO_NS };
}
