import { beforeEach, afterEach, describe, it, expect, vi } from "vite-plus/test";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useFilterSuggestions } from "./use-filter-suggestions";
import type { EventTimeWindow } from "@/lib/event-time-window";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request } }));
beforeEach(() => {
  vi.useFakeTimers();
  request.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function setup(key?: string, input = "") {
  const window: EventTimeWindow = {
    mode: "fixed",
    from: "2026-09-14T00:00:00.123456789Z",
    to: "2026-09-14T01:00:00Z",
  };
  const view = renderHook(
    ({ key, input, enabled, window }) =>
      useFilterSuggestions("traces", key, input, window, enabled),
    { initialProps: { key, input, enabled: true, window: window as EventTimeWindow } },
  );
  return {
    ...view,
    rerender: (props: {
      key: string | undefined;
      input: string;
      enabled: boolean;
      window?: EventTimeWindow;
    }) => view.rerender({ window, ...props }),
  };
}
describe("DB filter suggestions", () => {
  it("fetches unloaded keys after debouncing, with the selected time window", async () => {
    request.mockResolvedValue({ filterSuggestions: ["attributes.unloaded"] });
    const { result, rerender } = setup();
    rerender({ key: undefined, input: "unloaded", enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(199));
    expect(request).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(2));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].variables).toEqual({
      signal: "traces",
      key: undefined,
      input: "unloaded",
      from: "2026-09-14T00:00:00.123456789Z",
      to: "2026-09-14T01:00:00Z",
    });
    expect(result.current.items).toEqual(["attributes.unloaded"]);
  });
  it("discards stale responses and aborts them when the key changes", async () => {
    let resolve!: (data: { filterSuggestions: string[] }) => void;
    request
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce({ filterSuggestions: ["new"] });
    const { result, rerender } = setup("attributes.old");
    await act(() => vi.advanceTimersByTimeAsync(201));
    const oldSignal = request.mock.calls[0][0].signal as AbortSignal;
    rerender({ key: "attributes.new", input: "", enabled: true });
    expect(oldSignal.aborted).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(201));
    await act(async () => resolve({ filterSuggestions: ["old"] }));
    expect(result.current.items).toEqual(["new"]);
  });
  it("refreshes on window changes and exposes errors without stale candidates", async () => {
    request
      .mockResolvedValueOnce({ filterSuggestions: ["old"] })
      .mockRejectedValueOnce(new Error("offline"));
    const { rerender, result } = setup();
    await act(() => vi.advanceTimersByTimeAsync(201));
    rerender({ key: undefined, input: "", enabled: true, window: { mode: "live", range: "5m" } });
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(201));
    expect(result.current.error).toBe(true);
    expect(result.current.loading).toBe(false);
  });
  it("does not query disabled value inputs", async () => {
    const { rerender, unmount } = setup();
    rerender({ key: "", input: "", enabled: false });
    await act(() => vi.advanceTimersByTimeAsync(201));
    expect(request).not.toHaveBeenCalled();
    unmount();
  });
});
