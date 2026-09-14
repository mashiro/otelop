import { beforeEach, afterEach, describe, it, expect, vi } from "vite-plus/test";
import { renderHook, act, cleanup } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { useLiveTraceSearch } from "./use-live-trace-search";
import { addTracesAtom, serverMatchedTraceIdsAtom } from "@/stores/telemetry";
import { makeTrace } from "@/test/factories";
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
function setup(search = 'attributes.http.method:"GET"') {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const view = renderHook(
    ({ search }) =>
      useLiveTraceSearch(
        { mode: "fixed", from: "2024-01-01T00:00:00Z", to: "2024-01-01T00:01:00Z" },
        search,
      ),
    { wrapper, initialProps: { search } },
  );
  return { store, ...view };
}
describe("live trace search", () => {
  it("coalesces updates and applies authoritative matches within the window", async () => {
    request.mockResolvedValue({ matchingTraceIds: ["child-match"] });
    const { store } = setup();
    act(() =>
      store.set(addTracesAtom, [
        makeTrace({ traceId: "child-match", spans: [] }),
        makeTrace({ traceId: "miss", spans: [] }),
      ]),
    );
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toMatchObject({
      traceIds: ["child-match", "miss"],
      from: "2024-01-01T00:00:00Z",
      to: "2024-01-01T00:01:00Z",
    });
    expect([...store.get(serverMatchedTraceIdsAtom)]).toEqual(["child-match"]);
  });
  it("does not apply a result after the search changes", async () => {
    let resolve!: (value: { matchingTraceIds: string[] }) => void;
    request.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { store, rerender } = setup();
    act(() => store.set(addTracesAtom, [makeTrace({ traceId: "late", spans: [] })]));
    await act(() => vi.advanceTimersByTimeAsync(500));
    rerender({ search: 'name:"another"' });
    await act(async () => resolve({ matchingTraceIds: ["late"] }));
    expect(store.get(serverMatchedTraceIdsAtom).has("late")).toBe(false);
  });
  it("rechecks an ID updated during an in-flight request", async () => {
    let resolve!: (value: { matchingTraceIds: string[] }) => void;
    request
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce({ matchingTraceIds: [] });
    const { store } = setup();
    act(() => store.set(addTracesAtom, [makeTrace({ traceId: "updated", spans: [] })]));
    await act(() => vi.advanceTimersByTimeAsync(500));
    act(() =>
      store.set(addTracesAtom, [makeTrace({ traceId: "updated", spanCount: 2, spans: [] })]),
    );
    await act(async () => resolve({ matchingTraceIds: ["updated"] }));
    expect(store.get(serverMatchedTraceIdsAtom).has("updated")).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(request).toHaveBeenCalledTimes(2);
    expect(store.get(serverMatchedTraceIdsAtom).has("updated")).toBe(false);
  });
});
