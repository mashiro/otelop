import { describe, it, expect } from "vitest";
import { buildTree } from "./span-waterfall";
import { makeSpan } from "@/test/factories";

describe("buildTree", () => {
  it("returns a single root span", () => {
    const spans = [makeSpan({ spanID: "a" })];
    const result = buildTree(spans);
    expect(result).toHaveLength(1);
    expect(result[0].depth).toBe(0);
    expect(result[0].hasChildren).toBe(false);
  });

  it("builds parent-child hierarchy with correct depths", () => {
    const spans = [
      makeSpan({ spanID: "root", parentSpanID: "" }),
      makeSpan({ spanID: "child", parentSpanID: "root" }),
      makeSpan({ spanID: "grandchild", parentSpanID: "child" }),
    ];
    const result = buildTree(spans);
    expect(result).toHaveLength(3);
    expect(result.map((f) => ({ id: f.span.spanID, depth: f.depth }))).toEqual([
      { id: "root", depth: 0 },
      { id: "child", depth: 1 },
      { id: "grandchild", depth: 2 },
    ]);
  });

  it("sets hasChildren correctly", () => {
    const spans = [
      makeSpan({ spanID: "root", parentSpanID: "" }),
      makeSpan({ spanID: "child", parentSpanID: "root" }),
      makeSpan({ spanID: "leaf", parentSpanID: "child" }),
    ];
    const result = buildTree(spans);
    expect(result[0].hasChildren).toBe(true);
    expect(result[1].hasChildren).toBe(true);
    expect(result[2].hasChildren).toBe(false);
  });

  it("handles orphan spans as roots", () => {
    const spans = [
      makeSpan({ spanID: "a", parentSpanID: "nonexistent" }),
      makeSpan({ spanID: "b", parentSpanID: "" }),
    ];
    const result = buildTree(spans);
    expect(result).toHaveLength(2);
    expect(result.every((f) => f.depth === 0)).toBe(true);
  });

  it("handles empty span list", () => {
    expect(buildTree([])).toEqual([]);
  });
});
