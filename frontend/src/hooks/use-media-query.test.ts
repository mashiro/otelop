import { describe, it, expect, afterEach } from "vite-plus/test";
import { act, renderHook } from "@testing-library/react";
import { useMediaQuery } from "./use-media-query";
import { useBreakpoint } from "./use-breakpoint";

const { happyDOM } = window as unknown as {
  happyDOM: { setViewport(viewport: { width: number; height: number }): void };
};
const initial = { width: window.innerWidth, height: window.innerHeight };

afterEach(() => {
  happyDOM.setViewport(initial);
  document.documentElement.style.removeProperty("--breakpoint-sm");
});

// happy-dom only dispatches "change" when a query starts matching, so these
// tests widen the viewport; browsers fire it in both directions.
describe("useMediaQuery", () => {
  it("tracks viewport changes in every caller sharing a query", () => {
    happyDOM.setViewport({ width: 500, height: 768 });
    const a = renderHook(() => useMediaQuery("(min-width: 800px)"));
    const b = renderHook(() => useMediaQuery("(min-width: 800px)"));
    expect(a.result.current).toBe(false);
    expect(b.result.current).toBe(false);

    act(() => happyDOM.setViewport({ width: 1024, height: 768 }));
    expect(a.result.current).toBe(true);
    expect(b.result.current).toBe(true);
  });

  it("keeps listening after re-renders", () => {
    happyDOM.setViewport({ width: 600, height: 768 });
    const { result, rerender } = renderHook(() => useMediaQuery("(min-width: 900px)"));
    rerender();
    rerender();

    act(() => happyDOM.setViewport({ width: 1024, height: 768 }));
    expect(result.current).toBe(true);
  });
});

describe("useBreakpoint", () => {
  it("reads the breakpoint width from the theme variable", () => {
    document.documentElement.style.setProperty("--breakpoint-sm", "700px");
    happyDOM.setViewport({ width: 650, height: 768 });
    const { result } = renderHook(() => useBreakpoint("sm"));
    expect(result.current).toBe(false);

    act(() => happyDOM.setViewport({ width: 750, height: 768 }));
    expect(result.current).toBe(true);
  });
});
