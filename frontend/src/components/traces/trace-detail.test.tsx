import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createTestRouter } from "@/test/router";
import { makeSpan, makeTrace } from "@/test/factories";
import { tracesAtom } from "@/stores/telemetry";
import { useSpanLinks } from "@/hooks/use-span-links";
import { TraceDetail } from "./trace-detail";

vi.mock("@visx/responsive", () => ({
  useParentSize: () => ({ parentRef: { current: null }, width: 900, height: 600 }),
}));

vi.mock("@/hooks/use-span-links", () => ({
  useSpanLinks: vi.fn(),
}));

vi.mock("@/hooks/use-trace-spans", () => ({ useTraceSpans: () => {} }));

beforeEach(() => {
  vi.mocked(useSpanLinks).mockReturnValue({
    data: { pages: [{ items: [] }] },
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useSpanLinks>);
});

async function setup(path: string) {
  const store = createStore();
  store.set(tracesAtom, [
    makeTrace({ spans: [makeSpan({ linkCount: 2 })] }),
    makeTrace({
      traceId: "t2",
      spans: [makeSpan({ traceId: "t2", spanId: "s2", name: "publish" })],
    }),
  ]);
  const { router, wrapper } = await createTestRouter(path, store);
  render(<TraceDetail />, { wrapper });
  return router;
}

describe("span detail navigation", () => {
  it("opens links from their owning waterfall row without nesting another detail view", async () => {
    await setup("/traces/t1");
    fireEvent.click(screen.getByRole("button", { name: "Links for GET /api (2)" }));
    await screen.findByRole("heading", { name: "GET /api" });
    expect(screen.getByRole("tab", { name: "Links (2)" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(await screen.findByRole("button", { name: "Filter by kind" })).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Referenced by" }));
    expect(await screen.findByText("No retained spans reference this span.")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Links (2)" }));
    expect(await screen.findByText("No links recorded.")).toBeDefined();
  });
  it("uses browser back and forward for linked spans while retaining the source tab and scroll position", async () => {
    vi.mocked(useSpanLinks).mockReturnValue({
      data: {
        pages: [
          {
            items: [
              {
                ordinal: 0,
                sourceTraceId: "t1",
                sourceSpanId: "s1",
                traceId: "t2",
                spanId: "s2",
                targetStatus: "AVAILABLE",
                target: { traceId: "t2", spanId: "s2", name: "publish", serviceName: "worker" },
                attributes: {},
                traceFlags: 1,
                flags: 1,
                isRemote: true,
                droppedAttributesCount: 0,
              },
            ],
          },
        ],
      },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSpanLinks>);
    const router = await setup("/traces/t1/spans/s1?range=6h&spanTab=links");
    expect(screen.getByRole("tab", { name: "Links (2)" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.scroll(screen.getByLabelText("Span information content"), {
      target: { scrollTop: 160 },
    });
    fireEvent.click(screen.getByRole("link", { name: "publish worker" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/traces/t2/spans/s2"));
    expect(router.state.location.search.spanTab).toBeUndefined();
    expect(screen.queryByRole("link", { name: /^Back to / })).toBeNull();
    act(() => router.history.back());
    await waitFor(() => expect(router.state.location.pathname).toBe("/traces/t1/spans/s1"));
    expect(screen.getByRole("tab", { name: "Links (2)" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByLabelText("Span information content").scrollTop).toBe(160);
    expect(router.state.location.search.range).toBe("6h");
    act(() => router.history.forward());
    await waitFor(() => expect(router.state.location.pathname).toBe("/traces/t2/spans/s2"));
    expect(screen.queryByRole("link", { name: /^Back to / })).toBeNull();
  });

  it("keeps the selected tab in URL history and does not reset it on row clicks", async () => {
    const router = await setup("/traces/t1/spans/s1?spanTab=referenced-by&range=6h");
    expect(screen.getByRole("tab", { name: "Referenced by" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "GET /api timeline" }));
    await waitFor(() => expect(router.state.location.search.spanTab).toBe("referenced-by"));
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    await waitFor(() => expect(router.state.location.search.spanTab).toBeUndefined());
    act(() => router.history.back());
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Referenced by" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    act(() => router.history.forward());
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
  });

  it.each(["links", "referenced-by"])(
    "restores %s from a fresh URL and clears spanTab when closing",
    async (tab) => {
      const router = await setup(`/traces/t1/spans/s1?range=6h&spanTab=${tab}`);
      expect(
        screen
          .getByRole("tab", { name: tab === "links" ? "Links (2)" : "Referenced by" })
          .getAttribute("aria-selected"),
      ).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Close span details" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/traces/t1"));
      expect(router.state.location.searchStr).not.toContain("spanTab");
      expect(router.state.location.search.range).toBe("6h");
    },
  );

  it("defaults an invalid tab to Details", async () => {
    await setup("/traces/t1/spans/s1?spanTab=invalid");
    expect(screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
  });

  it("records span selection and restores it through browser history", async () => {
    const router = await setup("/traces/t1?range=6h");
    fireEvent.click(screen.getByRole("button", { name: "GET /api timeline" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/traces/t1/spans/s1"));
    expect(screen.getByRole("tab", { name: "Details" })).toBeDefined();
    expect(router.state.location.search.range).toBe("6h");
    fireEvent.click(screen.getByRole("button", { name: "Close span details" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/traces/t1"));
    act(() => router.history.back());
    await screen.findByRole("tab", { name: "Details" });
    act(() => router.history.forward());
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Details" })).toBeNull());
  });

  it("opens a span URL directly and dismisses one detail level per Escape", async () => {
    const router = await setup("/traces/t1/spans/s1?range=6h");
    expect(screen.getByRole("tab", { name: "Details" })).toBeDefined();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/traces/t1"));
    expect(screen.queryByRole("tab", { name: "Details" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close details" })).toBeDefined();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/traces"));
    expect(router.state.location.search.range).toBe("6h");
  });

  it("filters by a field recognized as a trace field, not an attribute", async () => {
    // "kind" is in traceFields (lib/trace-search.ts) but not in the default
    // fields draftTerm falls back to — this is the one thing
    // useFilterByAction("traces") (hooks/use-filter-by-action.tsx) branches
    // on, so a wrong `fields` list here would silently turn every trace
    // filter into an attributes.* term instead.
    const router = await setup("/traces/t1/spans/s1?range=6h");
    fireEvent.click(screen.getByRole("button", { name: "Filter by kind" }));
    await waitFor(() => expect(router.state.location.search.filter).toHaveLength(1));
    expect(router.state.location.search.filter?.[0]).toBe('kind:"Server"');
  });
});
