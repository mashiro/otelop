import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { makeSpan, makeTrace } from "@/test/factories";
import { SpanWaterfall } from "./span-waterfall";

vi.mock("@visx/responsive", () => ({
  useParentSize: () => ({ parentRef: { current: null }, width: 900, height: 600 }),
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

  it("highlights both halves of a row", () => {
    const select = vi.fn();
    render(<SpanWaterfall trace={trace} selectedSpan={null} onSelectSpan={select} />);
    const label = screen.getByRole("button", { name: /^payment,/ });
    const timeline = screen.getByRole("button", { name: "payment timeline" });
    fireEvent.mouseEnter(timeline);
    expect(label.classList.contains("bg-trace/5")).toBe(true);
    expect(timeline.classList.contains("bg-trace/5")).toBe(true);
    fireEvent.mouseLeave(timeline);
    expect(label.classList.contains("bg-trace/5")).toBe(false);
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
  it("keeps ancestors when finding a span inside a collapsed branch", () => {
    render(<SpanWaterfall trace={trace} selectedSpan={null} onSelectSpan={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find span" }), {
      target: { value: "payment" },
    });
    expect(screen.getByRole("button", { name: /^checkout,/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^payment,/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^background job,/ })).toBeNull();
  });

  it("filters errors with their parent context", () => {
    render(<SpanWaterfall trace={trace} selectedSpan={null} onSelectSpan={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Errors only" }));
    expect(screen.getByRole("button", { name: /^payment,/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^checkout,/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^background job,/ })).toBeNull();
  });

  it("clips bars to the selected range and leaves out-of-range rows empty", () => {
    const early = makeSpan({
      name: "early",
      spanId: "early",
      startTime: "2024-01-01T00:00:00Z",
      endTime: "2024-01-01T00:00:00.000000100Z",
      duration: 100,
    });
    render(
      <SpanWaterfall
        trace={makeTrace({ spans: [early], duration: 1000 })}
        range={[50, 100]}
        selectedSpan={null}
        onSelectSpan={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "early timeline" }).children.length).toBe(0);
  });
});
