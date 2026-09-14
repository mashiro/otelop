import { describe, expect, it } from "vite-plus/test";
import { parseSearch, stringifySearch, validateSearch } from "./route-search";

describe("route search compatibility", () => {
  it("round-trips repeated filters, literal text, and nanosecond timestamps", () => {
    const search =
      "?q=001&filter=service%3Aapi&filter=status%3Aerror&disabled_filter=body%3Afalse&from=2026-09-14T00%3A00%3A00.123456789Z&to=2026-09-14T01%3A00%3A00Z";
    const parsed = validateSearch(parseSearch(search));
    expect(parsed.q).toBe("001");
    expect(parsed.filter).toEqual(["service:api", "status:error"]);
    expect(parsed.disabled_filter).toEqual(["body:false"]);
    expect(parsed.from).toBe("2026-09-14T00:00:00.123456789Z");
    expect(validateSearch(parseSearch(stringifySearch({ ...parsed })))).toEqual(parsed);
  });
  it("rejects invalid ranges and accepts single filter values from typed navigation", () => {
    expect(validateSearch({ range: "invalid", q: 123, filter: "service:api" })).toMatchObject({
      range: undefined,
      q: undefined,
      filter: ["service:api"],
    });
  });
});
