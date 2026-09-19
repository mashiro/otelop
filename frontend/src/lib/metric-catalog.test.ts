import { describe, it, expect } from "vite-plus/test";
import {
  computeAttributeCardinality,
  facetId,
  lookupMetricRule,
  resolveMetricFacets,
  resolveMetricUnit,
} from "./metric-catalog";
import { makeDataPoint } from "@/test/factories";

describe("lookupMetricRule", () => {
  it("matches exact well-known metric names", () => {
    const rule = lookupMetricRule("http.server.request.duration");
    expect(rule?.unit).toBe("s");
    expect(rule?.keys?.[0]?.attributes).toEqual(["http.request.method", "http.route"]);
    expect(rule?.keys?.[0]?.label).toBe("Method + Route");
  });

  it("falls back to prefix rule for non-exact names", () => {
    const rule = lookupMetricRule("http.server.connection.duration");
    expect(rule?.keys?.[0]?.label).toBe("Method + Route");
  });

  it("returns undefined for unknown metrics", () => {
    expect(lookupMetricRule("claude_code.token.usage")).toBeUndefined();
  });
});

describe("resolveMetricUnit", () => {
  it("prefers declared unit", () => {
    expect(resolveMetricUnit("http.server.request.duration", "ms")).toBe("ms");
  });

  it("falls back to catalog unit when declared is empty", () => {
    expect(resolveMetricUnit("http.server.request.duration", "")).toBe("s");
    expect(resolveMetricUnit("jvm.memory.used", "")).toBe("By");
  });

  it("returns empty string when neither is available", () => {
    expect(resolveMetricUnit("custom_metric", "")).toBe("");
  });
});

describe("resolveMetricFacets", () => {
  const m = (entries: Array<[string, number]>) => new Map(entries);

  it("returns catalog tuples first, then discovered singles with friendly labels", () => {
    const facets = resolveMetricFacets(
      "http.server.request.duration",
      m([
        ["http.request.method", 3],
        ["http.route", 5],
        ["http.response.status_code", 4],
      ]),
    );
    expect(facets.map((f) => f.label)).toEqual([
      "Method + Route", // catalog tuple first
      "Method", // discovered, labeled via ATTRIBUTE_LABELS
      "Status",
      "Route",
    ]);
  });

  it("drops a catalog tuple when any of its attributes is missing", () => {
    const facets = resolveMetricFacets(
      "http.server.request.duration",
      m([
        ["http.request.method", 3],
        ["http.response.status_code", 2],
      ]),
    );
    // Method + Route needs http.route which is missing → tuple dropped.
    expect(facets.map((f) => f.label)).toEqual(["Method", "Status"]);
  });

  it("skips discovered attributes with cardinality 1 (constants)", () => {
    const facets = resolveMetricFacets(
      "claude_code.token.usage",
      m([
        ["type", 4],
        ["user.id", 1],
        ["organization.id", 1],
        ["model", 1],
      ]),
    );
    expect(facets.map((f) => f.label)).toEqual(["type"]);
  });

  it("skips discovered attributes with cardinality above the cap", () => {
    const facets = resolveMetricFacets(
      "custom.request.count",
      m([
        ["tier", 3],
        ["request.id", 500],
      ]),
    );
    expect(facets.map((f) => f.label)).toEqual(["tier"]);
  });

  it("drops high-cardinality noise attributes even on known metrics", () => {
    const facets = resolveMetricFacets(
      "http.server.request.duration",
      m([
        ["http.request.method", 3],
        ["http.route", 100], // above cap
      ]),
    );
    // Tuple is kept (attribute presence check only), but the solo Route facet
    // from discovery is suppressed because route is too high-cardinality.
    expect(facets.map((f) => f.label)).toEqual(["Method + Route", "Method"]);
  });

  it("uses friendly labels from ATTRIBUTE_LABELS for known singles", () => {
    const facets = resolveMetricFacets(
      "jvm.memory.used",
      m([
        ["jvm.memory.pool.name", 4],
        ["jvm.memory.type", 2],
      ]),
    );
    expect(facets.map((f) => f.label)).toEqual(["Pool", "Type"]);
  });

  it("returns empty list when there are no attributes", () => {
    expect(resolveMetricFacets("http.server.request.duration", m([]))).toEqual([]);
  });
});

describe("computeAttributeCardinality", () => {
  it("counts distinct string values per attribute", () => {
    const counts = computeAttributeCardinality([
      makeDataPoint({ attributes: { model: "opus" } }),
      makeDataPoint({ attributes: { model: "haiku" } }),
      makeDataPoint({ attributes: { model: "opus" } }),
    ]);
    expect(counts.get("model")).toBe(2);
  });

  it("skips null and undefined values without counting them", () => {
    const counts = computeAttributeCardinality([
      makeDataPoint({ attributes: { region: null, tier: undefined } }),
    ]);
    expect(counts.has("region")).toBe(false);
    expect(counts.has("tier")).toBe(false);
  });

  it("JSON-stringifies non-string values", () => {
    const counts = computeAttributeCardinality([
      makeDataPoint({ attributes: { count: 1 } }),
      makeDataPoint({ attributes: { count: true } }),
      makeDataPoint({ attributes: { count: { a: 1 } } }),
    ]);
    // 1, true, and {a:1} are three distinct stringified values.
    expect(counts.get("count")).toBe(3);
  });

  it("caps the tracked set at DISCOVERED_FACET_MAX + 1 so it can still read above the cap", () => {
    const exactlyAtCap = computeAttributeCardinality(
      Array.from({ length: 20 }, (_, i) => makeDataPoint({ attributes: { id: `v${i}` } })),
    );
    expect(exactlyAtCap.get("id")).toBe(20);

    const oneOverCap = computeAttributeCardinality(
      Array.from({ length: 21 }, (_, i) => makeDataPoint({ attributes: { id: `v${i}` } })),
    );
    expect(oneOverCap.get("id")).toBe(21);

    const wayOverCap = computeAttributeCardinality(
      Array.from({ length: 25 }, (_, i) => makeDataPoint({ attributes: { id: `v${i}` } })),
    );
    expect(wayOverCap.get("id")).toBe(21);
  });
});

describe("facetId", () => {
  it("joins attributes with a stable delimiter", () => {
    expect(facetId({ attributes: ["a"], label: "A" })).toBe("a");
    expect(facetId({ attributes: ["a", "b"], label: "A+B" })).toBe("a|b");
  });
});
