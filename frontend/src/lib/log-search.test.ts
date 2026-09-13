import { describe, expect, it } from "vite-plus/test";
import { createLogSearchMatcher } from "./log-search";
import { makeLog } from "@/test/factories";

const log = makeLog({
  body: "request failed",
  serviceName: "api",
  severityText: "ERROR",
  attributes: {
    "http.method": "GET",
    "http.status_code": 500,
    retry: false,
    "user.name": "Alice Smith",
    literal: "100%_done*",
    "path/~key": "ok",
    "quote'key": "safe",
    multiline: "one\ntwo",
    null: null,
    empty: "",
  },
  resource: { "service.name": "api" },
});

describe("log search for live arrivals", () => {
  it.each([
    ["attributes.http.method:GET", true],
    ["-attributes.http.method:GET", false],
    ["-attributes.http.method:POST", true],
    ["-attributes.missing:*", true],
    ["-attributes.http.method:*", false],
    ["attributes.http.status_code:>499", true],
    ["attributes.http.status_code:>=500", true],
    ["attributes.http.status_code:<500", false],
    ["attributes.http.status_code:<=500", true],
    ["attributes.http.method:>0", false],
    ['attributes.user.name:~"*Alice Sm*"', true],
    ["attributes.http.method:get", true],
    ["attributes.http.method:GE", false],
    ["attributes.HTTP.method:GET", false],
    ["attributes.http.method:G*", true],
    ["attributes.http.method:*", true],
    ["attributes.missing:*", false],
    ["attributes.null:*", false],
    ["attributes.empty:*", true],
    ['attributes.empty:""', true],
    ["attributes.http.status_code:500 attributes.retry:false", true],
    ["attributes.http.method:GET AND resource.service.name:api", true],
    ["attributes.http.method:GET AND resource.service.name:worker", false],
    ["failed attributes.http.method:GET resource.service.name:api", true],
    ["unrelated attributes.http.method:GET", false],
    ['attributes.user.name:"Alice Smith"', true],
    ['attributes.literal:"100%_done*"', true],
    ['attributes.literal:"100%_done"', false],
    ["attributes.path/~key:ok", true],
    ["attributes.quote'key:safe", true],
    [`attributes.http.method:"' OR 1=1 --"`, false],
    ["attributes.multiline:o*two", true],
    ['attributes.http.method:"GET', false],
    ["attributes.toString:*", false],
    ["request failed", true],
    ["ERROR", true],
    ["", true],
  ])("%s → %s", (query, expected) => {
    expect(createLogSearchMatcher(query)(log)).toBe(expected);
  });

  it("preserves free-text URLs and punctuation", () => {
    const row = makeLog({ body: "GET https://example.test:8080 100%_done" });
    expect(createLogSearchMatcher("https://example.test:8080")(row)).toBe(true);
    expect(createLogSearchMatcher("100%_done")(row)).toBe(true);
  });

  it("matches quoted escapes literally", () => {
    const row = makeLog({ attributes: { message: 'say "hello" \\ goodbye' } });
    expect(createLogSearchMatcher('attributes.message:"say \\"hello\\" \\\\ goodbye"')(row)).toBe(
      true,
    );
  });
});

describe("plain JSON search", () => {
  const jsonLog = makeLog({
    body: "ordinary body",
    attributes: {
      "custom.key": "100%_done",
      attempts: 987654,
      payload: { customer: "Alice Smith", tags: ["nested-token"] },
    },
    resource: { "deployment.zone": "Tokyo-East" },
  });
  it.each([
    "custom.key",
    "100%_done",
    "987654",
    "ALICE SMITH",
    "nested-token",
    "deployment.zone",
    "tokyo-east",
    "nested-token attributes.attempts:987654",
  ])("matches %s", (query) => {
    expect(createLogSearchMatcher(query)(jsonLog)).toBe(true);
  });
  it.each(["100X_done", "nested-missing", "nested-token attributes.attempts:1"])(
    "excludes %s",
    (query) => {
      expect(createLogSearchMatcher(query)(jsonLog)).toBe(false);
    },
  );
});
