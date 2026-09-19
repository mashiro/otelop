import { describe, it, expect, vi } from "vite-plus/test";
import { renderHook, act } from "@testing-library/react";
import { useLoadOlderRows } from "./use-load-older-rows";
import type { RenderWindow } from "./use-render-window";
import type { SignalListPage } from "./use-signal-list-page";

interface Item {
  id: string;
}

function makeRenderWindow(overrides: Partial<RenderWindow<Item>> = {}): RenderWindow<Item> {
  return {
    visible: [],
    newerCount: 0,
    olderCount: 0,
    isHead: true,
    slideOlder: vi.fn(),
    backToLatest: vi.fn(),
    ...overrides,
  };
}

function makePage(overrides: Partial<SignalListPage> = {}): SignalListPage {
  return {
    hasMore: false,
    loadingMore: false,
    loadMore: vi.fn(),
    requestKey: "k",
    ...overrides,
  };
}

describe("useLoadOlderRows", () => {
  it("slides locally when olderCount > 0, without fetching", () => {
    const renderWindow = makeRenderWindow({ olderCount: 5 });
    const page = makePage({ hasMore: true });
    const items: Item[] = [{ id: "a" }];
    const { result } = renderHook(() => useLoadOlderRows({ renderWindow, page, items }));

    expect(result.current.canLoadMore).toBe(true);
    act(() => result.current.loadMore());

    expect(renderWindow.slideOlder).toHaveBeenCalledExactlyOnceWith(items);
    expect(page.loadMore).not.toHaveBeenCalled();
  });

  it("falls through to fetching, then slides once loadingMore falls back to false", () => {
    let renderWindow = makeRenderWindow({ olderCount: 0 });
    let page = makePage({ hasMore: true });
    let items: Item[] = [{ id: "a" }];
    const { result, rerender } = renderHook(
      (props: { renderWindow: RenderWindow<Item>; page: SignalListPage; items: Item[] }) =>
        useLoadOlderRows(props),
      { initialProps: { renderWindow, page, items } },
    );

    act(() => result.current.loadMore());
    expect(page.loadMore).toHaveBeenCalledOnce();
    expect(renderWindow.slideOlder).not.toHaveBeenCalled();

    // The fetch is in flight — nothing should slide yet.
    page = makePage({ hasMore: true, loadingMore: true });
    rerender({ renderWindow, page, items });
    expect(renderWindow.slideOlder).not.toHaveBeenCalled();

    // The fetch lands: loadingMore falls back to false and the freshly
    // appended items are already reflected in `items`.
    page = makePage({ hasMore: false, loadingMore: false });
    items = [{ id: "a" }, { id: "b" }];
    rerender({ renderWindow, page, items });

    expect(renderWindow.slideOlder).toHaveBeenCalledExactlyOnceWith(items);
  });

  it("does nothing when there's nothing loaded locally and no more to fetch", () => {
    const renderWindow = makeRenderWindow({ olderCount: 0 });
    const page = makePage({ hasMore: false });
    const items: Item[] = [{ id: "a" }];
    const { result } = renderHook(() => useLoadOlderRows({ renderWindow, page, items }));

    expect(result.current.canLoadMore).toBe(false);
    act(() => result.current.loadMore());

    expect(renderWindow.slideOlder).not.toHaveBeenCalled();
    expect(page.loadMore).not.toHaveBeenCalled();
  });
});
