import type { SpanData, TraceData } from "@/types/telemetry";
import { createTermMatcher, parseLogSearch, type LogSearchTerm } from "./log-search";

export const traceFields = [
  "trace_id",
  "span_id",
  "parent_span_id",
  "service_name",
  "name",
  "kind",
  "status_code",
  "status_message",
  "duration_ms",
] as const;
const spanFields = {
  trace_id: "traceId",
  span_id: "spanId",
  parent_span_id: "parentSpanId",
  service_name: "serviceName",
  name: "name",
  kind: "kind",
  status_code: "statusCode",
  status_message: "statusMessage",
} as const;
export function traceTermValue(span: Partial<SpanData>, term: LogSearchTerm): unknown {
  if (term.field === "duration_ms")
    return span.duration === undefined ? undefined : span.duration / 1e6;
  if (term.field) {
    const key = spanFields[term.field as keyof typeof spanFields];
    const value = key ? span[key] : undefined;
    if (term.field.endsWith("_id") && (!value || /^0+$/.test(String(value)))) return undefined;
    return value;
  }
  const attrs = (term.resource ? span.resource : span.attributes) ?? {};
  return Object.hasOwn(attrs, term.key) ? attrs[term.key] : undefined;
}
export const parseTraceSearch = (search: string) => parseLogSearch(search, traceFields);
export function createTraceSearchMatcher(search: string): (trace: TraceData) => boolean {
  const { plain, terms } = parseTraceSearch(search);
  const q = plain.toLowerCase();
  const matchers = terms.map((term) => createTermMatcher(term, term.field === "duration_ms"));
  return (trace) => {
    if (
      !terms.length &&
      (!q ||
        [
          trace.traceId,
          trace.serviceName,
          trace.rootSpan?.name,
          trace.rootSpan?.statusCode,
          ...(trace.searchValues ?? []),
        ].some((value) => value?.toLowerCase().includes(q)))
    )
      return true;
    // Summary rows cannot prove attribute presence OR absence. The page query
    // supplies authoritative matches; full spans are used after detail loads.
    const spans: Partial<SpanData>[] = trace.spans.length
      ? trace.spans
      : [{ ...trace.rootSpan, traceId: trace.traceId, serviceName: trace.serviceName }];
    if (
      !trace.spans.length &&
      terms.some(
        (term) =>
          !term.field ||
          !["trace_id", "service_name", "name", "kind", "status_code", "duration_ms"].includes(
            term.field,
          ),
      )
    )
      return false;
    // A rootless summary has no name/kind/status/duration to test, including
    // for negation. Only its trace ID and representative service are known.
    if (
      !trace.spans.length &&
      !trace.rootSpan &&
      terms.some((term) => term.field !== "trace_id" && term.field !== "service_name")
    )
      return false;
    return spans.some((span) => {
      const textMatches =
        !q ||
        [
          span.traceId,
          span.spanId,
          span.name,
          span.statusCode,
          span.statusMessage,
          span.serviceName,
          JSON.stringify(span.attributes),
          JSON.stringify(span.resource),
          JSON.stringify(span.events),
        ].some((value) => value?.toLowerCase().includes(q)) ||
        (!terms.length && trace.searchValues?.some((value) => value.toLowerCase().includes(q)));
      return (
        textMatches && matchers.every((match, index) => match(traceTermValue(span, terms[index])))
      );
    });
  };
}
