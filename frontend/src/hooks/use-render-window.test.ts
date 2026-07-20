import { describe, it, expect } from "vite-plus/test";
import { renderHook, act } from "@testing-library/react";
import { useRenderWindow } from "./use-render-window";

interface Item {
  id: string;
}

const makeItems = (count: number): Item[] =>
  Array.from({ length: count }, (_, i) => ({ id: `item-${String(i).padStart(3, "0")}` }));

// render_window_max is user-configurable and can be smaller than the fetch
// page size; sliding by a full page would then jump past rows that were
// never mounted. These tests pin the continuity guarantee: each slide's new
// top row adjoins the previous window's bottom row.
describe("useRenderWindow slide continuity", () => {
  it("never skips rows when max < pageSize", () => {
    const items = makeItems(180);
    const { result } = renderHook(() =>
      useRenderWindow({
        items,
        getId: (item: Item) => item.id,
        max: 50,
        pageSize: 100,
        resetKey: "k",
      }),
    );
    expect(result.current.visible[0]?.id).toBe("item-000");
    expect(result.current.visible.at(-1)?.id).toBe("item-049");

    act(() => result.current.slideOlder(items));
    expect(result.current.visible[0]?.id).toBe("item-050");
    expect(result.current.visible.at(-1)?.id).toBe("item-099");

    act(() => result.current.slideOlder(items));
    expect(result.current.visible[0]?.id).toBe("item-100");
    expect(result.current.visible.at(-1)?.id).toBe("item-149");
  });

  it("slides by a full page when max >= pageSize", () => {
    const items = makeItems(400);
    const { result } = renderHook(() =>
      useRenderWindow({
        items,
        getId: (item: Item) => item.id,
        max: 200,
        pageSize: 100,
        resetKey: "k",
      }),
    );
    act(() => result.current.slideOlder(items));
    expect(result.current.visible[0]?.id).toBe("item-100");
    expect(result.current.visible).toHaveLength(200);
  });
});
