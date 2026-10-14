import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { createTestRouter } from "@/test/router";
import { SpanLinks } from "./span-links";
import { SpanLinkDialog } from "./span-link-dialog";
import { makeSpan } from "@/test/factories";

const mocks = vi.hoisted(() => ({ detail: vi.fn(), list: vi.fn() }));
vi.mock("@/hooks/use-span-link", () => ({ useSpanLink: mocks.detail }));
vi.mock("@/hooks/use-span-links", () => ({ useSpanLinks: mocks.list }));
const link = {
  sourceTraceId: "source",
  sourceSpanId: "origin",
  ordinal: 24,
  traceId: "target",
  spanId: "destination",
  source: { traceId: "source", spanId: "origin", name: "consume", serviceName: "worker" },
  target: { traceId: "target", spanId: "destination", name: "publish", serviceName: "api" },
  attributes: { "message.id": "event-24" },
  traceState: "",
  flags: 0,
  droppedAttributesCount: 0,
};
function seed() {
  mocks.detail.mockReturnValue({ isSuccess: true, data: link });
  mocks.list.mockReturnValue({ data: { pages: [{ items: [link] }] } });
}
it("keeps link identity in URL history and opens destination Details", async () => {
  seed();
  const { router, wrapper } = await createTestRouter(
    "/traces/target/spans/destination?spanTab=referenced-by&range=6h",
  );
  render(
    <>
      <SpanLinks span={makeSpan({ traceId: "target", spanId: "destination" })} incoming />
      <SpanLinkDialog />
    </>,
    { wrapper },
  );
  expect(screen.queryByText("event-24")).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Link info" }));
  await screen.findByRole("dialog", { name: "SpanLink" });
  expect(router.state.location.search.link).toBe("source/origin/24");
  expect(screen.getByText("event-24")).toBeDefined();
  act(() => router.history.back());
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(router.state.location.search.spanTab).toBe("referenced-by");
  act(() => router.history.forward());
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("link", { name: "publish" }));
  await waitFor(() => expect(router.state.location.search.spanTab).toBeUndefined());
  expect(router.state.location.search.link).toBeUndefined();
  expect(router.state.location.search.range).toBe("6h");
});

it("loads a direct detail URL without list data and closes to its parent context", async () => {
  seed();
  const { router, wrapper } = await createTestRouter(
    "/traces/target/spans/destination?spanTab=referenced-by&link=source%2Forigin%2F24",
  );
  render(<SpanLinkDialog />, { wrapper });
  await screen.findByRole("dialog");
  expect(mocks.detail).toHaveBeenCalledWith({
    sourceTraceId: "source",
    sourceSpanId: "origin",
    ordinal: 24,
  });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(router.state.location.search.link).toBeUndefined());
  expect(router.state.location.search.spanTab).toBe("referenced-by");
});

it("shows deleted links without substituting another recorded link", async () => {
  mocks.detail.mockReturnValue({ isSuccess: true, data: null });
  const { wrapper } = await createTestRouter(
    "/traces/target/spans/destination?link=source%2Forigin%2F24",
  );
  render(<SpanLinkDialog />, { wrapper });
  expect(await screen.findByText("This SpanLink is no longer available.")).toBeDefined();
  expect(screen.queryByText("event-24")).toBeNull();
});

it("identifies both services and keeps unavailable target context readable", async () => {
  seed();
  mocks.detail.mockReturnValue({ isSuccess: true, data: { ...link, target: null } });
  const { wrapper } = await createTestRouter(
    "/traces/source/spans/origin?link=source%2Forigin%2F24",
  );
  render(<SpanLinkDialog />, { wrapper });
  expect(await screen.findByText("worker")).toBeDefined();
  expect(screen.getByText("Referenced span")).toBeDefined();
  expect(screen.getByText("Span not available")).toBeDefined();
  expect(screen.getByText("destination")).toBeDefined();
  expect(screen.getByRole("table", { name: "Link attributes" })).toBeDefined();
  expect(screen.getByText("event-24")).toBeDefined();
});
