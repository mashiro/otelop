import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { Subscriber } from "@/lib/websocket-manager";
import { queryClient } from "@/lib/query-client";
import { makeTrace } from "@/test/factories";
import { useSpanLinks } from "./use-span-links";

const mocks = vi.hoisted(() => ({ request: vi.fn(), subscribe: vi.fn() }));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: mocks.request } }));
vi.mock("@/lib/websocket-manager", () => ({ wsManager: { subscribe: mocks.subscribe } }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  queryClient.clear();
});

it("refreshes referenced-by only for relevant targets and cancels pending refresh on unmount", async () => {
  let subscriber!: Subscriber;
  mocks.subscribe.mockImplementation((value: Subscriber) => {
    subscriber = value;
    return vi.fn();
  });
  mocks.request.mockResolvedValue({
    trace: { span: { incomingLinks: { items: [], hasNextPage: false, endCursor: null } } },
  });
  const view = renderHook(() => useSpanLinks("target", "span", true));
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  vi.useFakeTimers();
  const send = (linkTargets: { traceId: string; spanId: string }[]) =>
    subscriber.onMessage({
      type: "traces",
      data: { ...makeTrace({ traceId: "source", linkCount: 128 }), linkTargets },
    });
  act(() => {
    send([{ traceId: "other", spanId: "span" }]);
    send([{ traceId: "target", spanId: "other" }]);
    vi.advanceTimersByTime(1100);
  });
  expect(invalidate).not.toHaveBeenCalled();
  act(() => {
    send([{ traceId: "target", spanId: "span" }]);
    send([{ traceId: "target", spanId: "span" }]);
    vi.advanceTimersByTime(1000);
  });
  expect(invalidate).toHaveBeenCalledTimes(1);
  act(() => send([{ traceId: "target", spanId: "span" }]));
  view.unmount();
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(invalidate).toHaveBeenCalledTimes(1);
});

it("refreshes outgoing links when a displayed target arrives or is removed", async () => {
  let subscriber!: Subscriber;
  mocks.subscribe.mockImplementation((value: Subscriber) => {
    subscriber = value;
    return vi.fn();
  });
  mocks.request.mockResolvedValue({
    trace: {
      span: {
        links: {
          items: [{ traceId: "target", spanId: "span" }],
          hasNextPage: false,
          endCursor: null,
        },
      },
    },
  });
  const view = renderHook(() => useSpanLinks("source", "origin", false));
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  vi.useFakeTimers();
  act(() => {
    subscriber.onMessage({
      type: "traces",
      data: makeTrace({ traceId: "unrelated", linkCount: 10 }),
    });
    vi.advanceTimersByTime(1000);
  });
  expect(invalidate).not.toHaveBeenCalled();
  act(() => {
    subscriber.onMessage({ type: "traces", data: makeTrace({ traceId: "target" }) });
    vi.advanceTimersByTime(1000);
  });
  expect(invalidate).toHaveBeenCalledTimes(1);
  act(() => {
    subscriber.onMessage({ type: "trace-deletes", data: { traceId: "target" } });
    vi.advanceTimersByTime(1000);
  });
  expect(invalidate).toHaveBeenCalledTimes(2);
  view.unmount();
});

it("reconciles after reconnect and periodically without notifications, including retention deletion", async () => {
  let subscriber!: Subscriber;
  mocks.subscribe.mockImplementation((value: Subscriber) => {
    subscriber = value;
    value.onStatus("connected");
    return vi.fn();
  });
  vi.useFakeTimers();
  const page = {
    items: [{ traceId: "target", spanId: "span" }],
    hasNextPage: false,
    endCursor: null,
  };
  mocks.request.mockResolvedValue({ trace: { span: { links: page } } });
  const view = renderHook(() => useSpanLinks("source", "origin", false));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(view.result.current.data?.pages[0]?.items).toHaveLength(1);
  mocks.request.mockResolvedValue({ trace: { span: { links: { ...page, items: [] } } } });
  await act(async () => {
    subscriber.onStatus("disconnected");
    subscriber.onStatus("connected");
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(view.result.current.data?.pages[0]?.items).toEqual([]);
  mocks.request.mockResolvedValue({ trace: null });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_010);
  });
  expect(view.result.current.isSuccess).toBe(true);
  expect(view.result.current.data?.pages[0]).toMatchObject({
    available: false,
    items: [],
    hasNextPage: false,
  });
  view.unmount();
  const calls = mocks.request.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.request).toHaveBeenCalledTimes(calls);
});

it("rebuilds loaded pages from the first cursor when notifications are missed", async () => {
  mocks.subscribe.mockReturnValue(vi.fn());
  vi.useFakeTimers();
  let revised = false;
  mocks.request.mockImplementation((_query, variables) => {
    const first = variables.after === null;
    return Promise.resolve({
      trace: {
        span: {
          incomingLinks: {
            items: [
              { sourceTraceId: revised ? "new-source" : first ? "first-source" : "last-source" },
            ],
            hasNextPage: !revised && first,
            endCursor: !revised && first ? "old-cursor" : null,
          },
        },
      },
    });
  });
  const view = renderHook(() => useSpanLinks("target", "span", true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  await act(async () => {
    await view.result.current.fetchNextPage();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(view.result.current.data?.pages).toHaveLength(2);
  revised = true;
  mocks.request.mockClear();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_010);
  });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request.mock.calls[0][1].after).toBeNull();
  expect(view.result.current.data?.pages).toHaveLength(1);
  expect(view.result.current.data?.pages[0].items).toEqual([{ sourceTraceId: "new-source" }]);
  expect(view.result.current.hasNextPage).toBe(false);
  view.unmount();
});
