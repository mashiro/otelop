import { describe, it, expect } from "vite-plus/test";
import { createTraceSearchMatcher, parseTraceSearch, traceFields } from "./trace-search";
import { draftTerm, filterDraftError } from "./log-filter";
import { makeTrace, makeSpan } from "@/test/factories";
describe("trace search", () => {
  const trace = makeTrace({
    spans: [
      makeSpan({
        name: "request",
        serviceName: "api",
        attributes: { "http.method": "GET", arguments: { cmd: "git diff --check" } },
      }),
      makeSpan({
        name: "query",
        serviceName: "db",
        duration: 2e6,
        attributes: { "http.status_code": 500, text: "500" },
        resource: { "service.name": "db" },
      }),
    ],
  });
  it.each([
    ['name:"query" duration_ms:>=2 resource.service.name:"db"', true],
    ['attributes.http.method:"GET" attributes.http.status_code:500', false],
    ['name:"query" -attributes.http.method:*', true],
    ['name:"request" -attributes.http.method:*', false],
    ['name:"query" duration_ms:"2.0"', true],
    ['name:"query" duration_ms:2e0', true],
    ['name:"query" -duration_ms:"2.0"', false],
    ['name:"query" duration_ms:"1"', false],
    ["attributes.text:>=500", false],
    ["diff", true],
    ['attributes.http.method:"GE"', false],
    ["attributes.http.method:G*", true],
  ])("%s -> %s", (query, expected) =>
    expect(createTraceSearchMatcher(query)(trace)).toBe(expected),
  );
  it("does not infer absent attributes from a summary", () =>
    expect(createTraceSearchMatcher("-attributes.missing:*")(makeTrace({ spans: [] }))).toBe(
      false,
    ));
  it.each(['-name:"query"', '-kind:"Client"', '-status_code:"Unset"', '-duration_ms:"1"'])(
    "does not infer %s from a rootless summary",
    (query) => {
      expect(createTraceSearchMatcher(query)(makeTrace({ spans: [], rootSpan: undefined }))).toBe(
        false,
      );
    },
  );
  it("still matches known fields on a rootless summary", () => {
    const summary = makeTrace({
      traceId: "rootless",
      serviceName: "db",
      spans: [],
      rootSpan: undefined,
    });
    expect(createTraceSearchMatcher('trace_id:"rootless" service_name:"db"')(summary)).toBe(true);
  });
  it("recognizes trace fields without accepting log-only fields", () => {
    expect(parseTraceSearch('severity_text:ERROR name:"request"')).toMatchObject({
      plain: "severity_text:ERROR",
      terms: [{ field: "name" }],
    });
    expect(draftTerm({ key: "duration_ms", operator: ">", value: "2" }, traceFields)).toMatchObject(
      { field: "duration_ms", value: ">2" },
    );
    expect(
      filterDraftError({ key: "name", operator: ">", value: "2" }, traceFields, ["duration_ms"]),
    ).toBeTruthy();
  });
});
