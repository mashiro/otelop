import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { createTestRouter } from "@/test/router";
import { makeSpan } from "@/test/factories";
import { SpanLinks } from "./span-links";

const fetchNextPage = vi.fn();
const refetch = vi.fn();
const useSpanLinks = vi.fn();
vi.mock("@/hooks/use-span-links", () => ({
  useSpanLinks: (...args: unknown[]) => useSpanLinks(...args),
}));
const target = { traceId: "target", spanId: "producer", serviceName: "checkout", name: "publish" };
const link = {
  ordinal: 0,
  sourceTraceId: "source",
  sourceSpanId: "consumer",
  traceId: "target",
  spanId: "producer",
  target,
  source: { ...target, traceId: "source", spanId: "consumer" },
  targetStatus: "AVAILABLE",
  attributes: { batch: 1 },
  flags: 0,
  traceFlags: 0,
  isRemote: null,
  traceState: "",
  droppedAttributesCount: 0,
};

describe("span links", () => {
  it("navigates to the exact target span and explicitly loads another page", async () => {
    useSpanLinks.mockReturnValue({
      data: { pages: [{ items: [link] }] },
      hasNextPage: true,
      fetchNextPage,
      refetch,
    });
    const { router, wrapper } = await createTestRouter("/traces/source/spans/consumer?range=6h");
    render(
      <SpanLinks
        span={makeSpan({
          traceId: "source",
          spanId: "consumer",
          name: "process_batch",
          serviceName: "worker",
          linkCount: 1,
          droppedLinksCount: 2,
        })}
        incoming={false}
      />,
      {
        wrapper,
      },
    );
    expect(screen.queryByRole("button", { name: "Link details" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
    expect(screen.queryByText("batch")).toBeNull();
    expect(screen.getByRole("link", { name: "Link info" }).getAttribute("href")).toContain(
      "link=source%2Fconsumer%2F0",
    );
    fireEvent.click(screen.getByRole("link", { name: /publish/ }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/traces/target/spans/producer"),
    );
    expect(router.state.location.search.range).toBe("6h");
  });
  it("distinguishes missing and invalid targets without offering navigation", async () => {
    useSpanLinks.mockReturnValue({
      data: {
        pages: [
          {
            items: [
              { ...link, target: null, targetStatus: "NOT_FOUND" },
              { ...link, ordinal: 1, target: null, targetStatus: "INVALID_CONTEXT" },
            ],
          },
        ],
      },
      refetch,
    });
    const { wrapper } = await createTestRouter("/traces/source/spans/consumer");
    render(
      <SpanLinks
        span={makeSpan({ traceId: "source", spanId: "consumer", linkCount: 2 })}
        incoming={false}
      />,
      {
        wrapper,
      },
    );
    expect(screen.getByText("Span not available")).toBeDefined();
    expect(screen.getByText("Invalid span context")).toBeDefined();
    expect(screen.getAllByRole("link", { name: "Link info" })).toHaveLength(2);
  });
});

it("shows authoritative span removal without stale links or a retry error", async () => {
  useSpanLinks.mockReturnValue({
    data: { pages: [{ available: false, items: [], hasNextPage: false }] },
    isSuccess: true,
  });
  const { wrapper } = await createTestRouter("/traces/source/spans/consumer");
  render(
    <SpanLinks span={makeSpan({ traceId: "source", spanId: "consumer" })} incoming={false} />,
    { wrapper },
  );
  expect(screen.getByText("The selected span is no longer available.")).toBeDefined();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.queryByText("No links recorded.")).toBeNull();
});
