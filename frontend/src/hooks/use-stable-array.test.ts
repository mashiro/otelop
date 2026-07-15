import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStableArray } from "./use-stable-array";

interface Item {
  id: string;
}

const byId = (item: Item) => item.id;

describe("useStableArray", () => {
  it("returns the same reference across renders when content is unchanged", () => {
    const first = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { result, rerender } = renderHook(
      ({ array }: { array: Item[] }) => useStableArray(array, byId),
      { initialProps: { array: first } },
    );

    const firstResult = result.current;
    expect(firstResult).toBe(first);

    // A fresh array literal with the same length and same first/last id.
    const contentEqual = [{ id: "a" }, { id: "x" }, { id: "c" }];
    rerender({ array: contentEqual });

    expect(result.current).toBe(firstResult);
    expect(result.current).not.toBe(contentEqual);
  });

  it("returns the new reference when content actually changes (a new item appended)", () => {
    const first = [{ id: "a" }, { id: "b" }];
    const { result, rerender } = renderHook(
      ({ array }: { array: Item[] }) => useStableArray(array, byId),
      { initialProps: { array: first } },
    );

    const grown = [{ id: "a" }, { id: "b" }, { id: "c" }];
    rerender({ array: grown });

    expect(result.current).toBe(grown);
  });

  it("returns the new reference when the last element's key changes", () => {
    const first = [{ id: "a" }, { id: "b" }];
    const { result, rerender } = renderHook(
      ({ array }: { array: Item[] }) => useStableArray(array, byId),
      { initialProps: { array: first } },
    );

    const changedTail = [{ id: "a" }, { id: "b2" }];
    rerender({ array: changedTail });

    expect(result.current).toBe(changedTail);
  });

  it("treats two empty arrays as content-equal", () => {
    const { result, rerender } = renderHook(
      ({ array }: { array: Item[] }) => useStableArray(array, byId),
      { initialProps: { array: [] as Item[] } },
    );

    const firstResult = result.current;
    rerender({ array: [] });

    expect(result.current).toBe(firstResult);
  });

  it("returns the exact same array instance passed in when reference is unchanged", () => {
    const array = [{ id: "a" }];
    const { result, rerender } = renderHook(() => useStableArray(array, byId));

    rerender();

    expect(result.current).toBe(array);
  });
});
