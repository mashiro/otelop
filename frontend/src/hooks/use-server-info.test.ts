import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useServerInfo } from "./use-server-info";
import { makeServerInfoResponse } from "@/test/factories";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("@/lib/graphql", () => ({ gqlClient: { request: requestMock } }));

beforeEach(() => {
  vi.useFakeTimers();
  requestMock.mockReset();
  requestMock.mockResolvedValue(makeServerInfoResponse());
});
afterEach(() => vi.useRealTimers());

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useServerInfo", () => {
  it("polls once a minute only while open", async () => {
    const { rerender, unmount } = renderHook(({ open }) => useServerInfo(open), {
      initialProps: { open: false },
    });
    await advance(60_000);
    expect(requestMock).not.toHaveBeenCalled();

    rerender({ open: true });
    await advance(1);
    expect(requestMock).toHaveBeenCalledTimes(1);
    await advance(59_998);
    expect(requestMock).toHaveBeenCalledTimes(1);
    await advance(2);
    expect(requestMock).toHaveBeenCalledTimes(2);

    rerender({ open: false });
    await advance(120_000);
    expect(requestMock).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("reuses fresh results on reopen and refetches stale results", async () => {
    const { rerender, unmount } = renderHook(({ open }) => useServerInfo(open), {
      initialProps: { open: true },
    });
    await advance(1);
    expect(requestMock).toHaveBeenCalledTimes(1);

    rerender({ open: false });
    await advance(5_000);
    rerender({ open: true });
    await advance(1);
    expect(requestMock).toHaveBeenCalledTimes(1);

    rerender({ open: false });
    await advance(60_000);
    rerender({ open: true });
    await advance(1);
    expect(requestMock).toHaveBeenCalledTimes(2);
    unmount();
  });
});
