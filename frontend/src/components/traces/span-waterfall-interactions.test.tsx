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

  it("reveals a linked selection and still lets the user collapse it again", () => {
    const select = vi.fn();
    const { rerender } = render(
      <SpanWaterfall trace={trace} selectedSpan={null} onSelectSpan={select} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse checkout" }));
    expect(screen.queryByRole("button", { name: "payment timeline" })).toBeNull();
    rerender(<SpanWaterfall trace={trace} selectedSpan={child} onSelectSpan={select} />);
    expect(screen.getByRole("button", { name: "payment timeline" })).toBeDefined();
    const collapse = screen.getByRole("button", { name: "Collapse checkout" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(collapse);
    expect(screen.queryByRole("button", { name: "payment timeline" })).toBeNull();
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

  it("does not add a selected non-match to search results", () => {
    render(<SpanWaterfall trace={trace} selectedSpan={sibling} onSelectSpan={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Find span" }), {
      target: { value: "payment" },
    });
    expect(screen.queryByRole("button", { name: /^background job,/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^payment,/ })).toBeTruthy();
  });

  it("filters errors with their parent context", () => {
    render(<SpanWaterfall trace={trace} selectedSpan={sibling} onSelectSpan={vi.fn()} />);
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

describe("selection updates", () => {
  it("does not scroll the selected row when unrelated spans arrive", () => {
    const scroll = vi.fn();
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const a = makeSpan({ spanId: "a" });
      const b = makeSpan({ spanId: "b" });
      const { rerender } = render(
        <SpanWaterfall trace={makeTrace({ spans: [a] })} selectedSpan={a} onSelectSpan={vi.fn()} />,
      );
      scroll.mockClear();
      rerender(
        <SpanWaterfall
          trace={makeTrace({ spans: [a, b] })}
          selectedSpan={a}
          onSelectSpan={vi.fn()}
        />,
      );
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });
  it("reveals a selected child again after navigating away and back", () => {
    const parent = makeSpan({ spanId: "p", name: "parent" });
    const child = makeSpan({ spanId: "c", parentSpanId: "p", name: "child" });
    const other = makeSpan({ spanId: "o", name: "other" });
    const trace = makeTrace({ spans: [parent, child, other] });
    const { rerender } = render(
      <SpanWaterfall trace={trace} selectedSpan={child} onSelectSpan={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse parent" }));
    rerender(<SpanWaterfall trace={trace} selectedSpan={other} onSelectSpan={vi.fn()} />);
    rerender(<SpanWaterfall trace={trace} selectedSpan={child} onSelectSpan={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "child timeline" })).not.toBeNull();
  });
});
