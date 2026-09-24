import { describe, it, expect, afterEach } from "vite-plus/test";
import { act, renderHook } from "@testing-library/react";
import { useMediaQuery } from "./use-media-query";
import { useBreakpoint } from "./use-breakpoint";
import { setViewport } from "@/test/factories";

const initial = { width: window.innerWidth, height: window.innerHeight };

afterEach(() => {
  setViewport(initial.width, initial.height);
  document.documentElement.style.removeProperty("--breakpoint-sm");
});

// Widen the viewport: happy-dom only fires "change" when a query starts
// matching, while browsers fire it in both directions.
describe("useMediaQuery", () => {
  it("tracks viewport changes in every caller sharing a query", () => {
    setViewport(500, 768);
    const a = renderHook(() => useMediaQuery("(min-width: 800px)"));
    const b = renderHook(() => useMediaQuery("(min-width: 800px)"));
    expect(a.result.current).toBe(false);
    expect(b.result.current).toBe(false);

    act(() => setViewport(1024, 768));
    expect(a.result.current).toBe(true);
    expect(b.result.current).toBe(true);
  });

  it("keeps listening after re-renders", () => {
    setViewport(600, 768);
    const { result, rerender } = renderHook(() => useMediaQuery("(min-width: 900px)"));
    rerender();
    rerender();

    act(() => setViewport(1024, 768));
    expect(result.current).toBe(true);
  });
});

describe("useBreakpoint", () => {
  it("reads the breakpoint width from the theme variable", () => {
    document.documentElement.style.setProperty("--breakpoint-sm", "700px");
    setViewport(650, 768);
    const { result } = renderHook(() => useBreakpoint("sm"));
    expect(result.current).toBe(false);

    act(() => setViewport(750, 768));
    expect(result.current).toBe(true);
  });
});
