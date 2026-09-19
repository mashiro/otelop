import { describe, it, expect } from "vite-plus/test";
import { buildTree, matchingSpanIds, visibleSpans } from "./span-tree";
import { makeSpan } from "@/test/factories";

describe("buildTree", () => {
  it("returns a single root span", () => {
    const spans = [makeSpan({ spanId: "a" })];
    const result = buildTree(spans);
    expect(result).toHaveLength(1);
    expect(result[0].depth).toBe(0);
    expect(result[0].hasChildren).toBe(false);
  });

  it("builds parent-child hierarchy with correct depths", () => {
    const spans = [
      makeSpan({ spanId: "root", parentSpanId: "" }),
      makeSpan({ spanId: "child", parentSpanId: "root" }),
      makeSpan({ spanId: "grandchild", parentSpanId: "child" }),
    ];
    const result = buildTree(spans);
    expect(result).toHaveLength(3);
    expect(result.map((f) => ({ id: f.span.spanId, depth: f.depth }))).toEqual([
      { id: "root", depth: 0 },
      { id: "child", depth: 1 },
      { id: "grandchild", depth: 2 },
    ]);
  });

  it("sets hasChildren correctly", () => {
    const spans = [
      makeSpan({ spanId: "root", parentSpanId: "" }),
      makeSpan({ spanId: "child", parentSpanId: "root" }),
      makeSpan({ spanId: "leaf", parentSpanId: "child" }),
    ];
    const result = buildTree(spans);
    expect(result[0].hasChildren).toBe(true);
    expect(result[1].hasChildren).toBe(true);
    expect(result[2].hasChildren).toBe(false);
  });

  it("handles orphan spans as roots", () => {
    const spans = [
      makeSpan({ spanId: "a", parentSpanId: "nonexistent" }),
      makeSpan({ spanId: "b", parentSpanId: "" }),
    ];
    const result = buildTree(spans);
    expect(result).toHaveLength(2);
    expect(result.every((f) => f.depth === 0)).toBe(true);
  });

  it("handles empty span list", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("matchingSpanIds", () => {
  const parent = makeSpan({ spanId: "parent", name: "checkout", serviceName: "web" });
  const child = makeSpan({
    spanId: "child",
    parentSpanId: "parent",
    name: "payment",
    serviceName: "billing",
    statusCode: "Error",
  });
  const grandchild = makeSpan({
    spanId: "grandchild",
    parentSpanId: "child",
    name: "charge card",
    serviceName: "billing",
  });
  const sibling = makeSpan({ spanId: "sibling", name: "background job", serviceName: "worker" });
  const spans = [parent, child, grandchild, sibling];

  it("returns null when no filter is active", () => {
    expect(matchingSpanIds(spans, { query: "", errorsOnly: false })).toBeNull();
    expect(matchingSpanIds(spans, { query: "   ", errorsOnly: false })).toBeNull();
  });

  it("matches the span name case-insensitively", () => {
    const ids = matchingSpanIds(spans, { query: "PAYMENT", errorsOnly: false });
    expect(ids?.has("child")).toBe(true);
    expect(ids?.has("sibling")).toBe(false);
  });

  it("matches the service name case-insensitively", () => {
    const ids = matchingSpanIds(spans, { query: "BILLING", errorsOnly: false });
    expect(ids?.has("child")).toBe(true);
    expect(ids?.has("sibling")).toBe(false);
  });

  it("includes every ancestor of a match, not just its direct parent", () => {
    const ids = matchingSpanIds(spans, { query: "charge card", errorsOnly: false });
    expect(ids).toEqual(new Set(["grandchild", "child", "parent"]));
  });

  it("filters to error spans and their ancestors", () => {
    const ids = matchingSpanIds(spans, { query: "", errorsOnly: true });
    expect(ids?.has("child")).toBe(true);
    expect(ids?.has("parent")).toBe(true);
    expect(ids?.has("sibling")).toBe(false);
  });
});

describe("visibleSpans", () => {
  const parent = makeSpan({ spanId: "parent", name: "checkout" });
  const child = makeSpan({ spanId: "child", parentSpanId: "parent", name: "payment" });
  const sibling = makeSpan({ spanId: "sibling", name: "background job" });
  const flatSpans = buildTree([parent, child, sibling]);

  it("shows every row when nothing is collapsed and no filter is active", () => {
    const result = visibleSpans(flatSpans, new Set(), null);
    expect(result.map((f) => f.span.spanId)).toEqual(["parent", "child", "sibling"]);
  });

  it("hides descendants of a collapsed span but keeps its siblings", () => {
    const result = visibleSpans(flatSpans, new Set(["parent"]), null);
    expect(result.map((f) => f.span.spanId)).toEqual(["parent", "sibling"]);
  });

  it("ignores collapse while a filter is active", () => {
    const matchingIds = new Set(["parent", "child"]);
    const result = visibleSpans(flatSpans, new Set(["parent"]), matchingIds);
    expect(result.map((f) => f.span.spanId)).toEqual(["parent", "child"]);
  });
});
