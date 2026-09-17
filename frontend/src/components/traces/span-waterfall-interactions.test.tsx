import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { makeSpan, makeTrace } from "@/test/factories";
import { SpanWaterfall } from "./span-waterfall";

vi.mock("@visx/responsive", () => ({
  useParentSize: () => ({ parentRef: { current: null }, width: 900 }),
}));

describe("SpanWaterfall interactions", () => {
  const parent = makeSpan({ spanId: "parent", name: "checkout" });
  const child = makeSpan({
    spanId: "child",
    parentSpanId: "parent",
    name: "payment",
    statusCode: "Error",
  });
  const sibling = makeSpan({ spanId: "sibling", name: "background job" });
  const trace = makeTrace({ spans: [parent, child, sibling], spanCount: 3 });

  it("collapses only descendants without selecting a span", () => {
    const select = vi.fn();
    render(<SpanWaterfall trace={trace} selectedSpan={null} onSelectSpan={select} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse checkout" }));
    expect(screen.queryByRole("button", { name: /payment,/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "payment timeline" })).toBeNull();
    expect(screen.getByRole("button", { name: /background job,/ })).toBeTruthy();
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Expand checkout" }));
    fireEvent.click(screen.getByRole("button", { name: /payment,.*Error/ }));
    expect(select).toHaveBeenCalledWith(child);
  });

  it("resets collapsed branches when moving to another trace", () => {
    const { rerender } = render(
      <SpanWaterfall trace={trace} selectedSpan={null} onSelectSpan={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse checkout" }));
    rerender(
      <SpanWaterfall
        trace={{ ...trace, traceId: "another-trace" }}
        selectedSpan={null}
        onSelectSpan={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /payment,/ })).toBeTruthy();
  });

  it("selects the same span from its timeline bar", () => {
    const select = vi.fn();
    render(<SpanWaterfall trace={trace} selectedSpan={null} onSelectSpan={select} />);
    fireEvent.click(screen.getByRole("button", { name: "payment timeline" }));
    expect(select).toHaveBeenCalledWith(child);
  });

  it("keeps sub-millisecond spans visible on the full multi-root trace range", () => {
    const early = makeSpan({
      spanId: "early",
      name: "early",
      startTime: "2024-01-01T00:00:00.000000000Z",
      endTime: "2024-01-01T00:00:00.000000100Z",
      duration: 100,
    });
    const late = makeSpan({
      spanId: "late",
      name: "late",
      startTime: "2024-01-01T00:00:00.000000500Z",
      endTime: "2024-01-01T00:00:00.000001000Z",
      duration: 500,
    });
    render(
      <SpanWaterfall
        trace={makeTrace({ spans: [early, late], duration: 1000, spanCount: 2 })}
        selectedSpan={late}
        onSelectSpan={vi.fn()}
      />,
    );
    const row = screen.getByRole("button", { name: /^late,/ });
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1.0µs")).toBeTruthy();
    expect(screen.getByText("100ns")).toBeTruthy();
    expect(screen.getByText("500ns")).toBeTruthy();
  });
});
