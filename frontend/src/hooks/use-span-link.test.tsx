import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { queryClient } from "@/lib/query-client";
import type { Subscriber } from "@/lib/websocket-manager";
import { useSpanLink } from "./use-span-link";
const mocks = vi.hoisted(() => ({ request: vi.fn(), subscribe: vi.fn() }));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: mocks.request } }));
vi.mock("@/lib/websocket-manager", () => ({ wsManager: { subscribe: mocks.subscribe } }));
afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
  vi.resetAllMocks();
});
it("fetches an exact identity and reconciles reconnects and silent deletions", async () => {
  vi.useFakeTimers();
  let subscriber!: Subscriber;
  mocks.subscribe.mockImplementation((s: Subscriber) => {
    subscriber = s;
    s.onStatus("connected");
    return vi.fn();
  });
  const identity = { sourceTraceId: "source", sourceSpanId: "span", ordinal: 24 };
  mocks.request.mockResolvedValue({
    spanLink: { ...identity, traceId: "target", attributes: { index: 24 }, target: null },
  });
  const view = renderHook(() => useSpanLink(identity));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(mocks.request.mock.calls[0][1]).toEqual(identity);
  expect(view.result.current.data?.target).toBeNull();
  mocks.request.mockResolvedValue({
    spanLink: { ...identity, traceId: "target", target: { name: "arrived" } },
  });
  await act(async () => {
    subscriber.onStatus("disconnected");
    subscriber.onStatus("connected");
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(view.result.current.data?.target?.name).toBe("arrived");
  mocks.request.mockResolvedValue({ spanLink: null });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_010);
  });
  expect(view.result.current.isSuccess).toBe(true);
  expect(view.result.current.data).toBeNull();
  view.unmount();
});
