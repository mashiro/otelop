import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { makeTrace } from "@/test/factories";
import { TraceOverview } from "./trace-overview";

describe("TraceOverview", () => {
  it("changes the selected start time and resets to the full range", () => {
    const change = vi.fn();
    const { rerender } = render(
      <TraceOverview
        trace={makeTrace({ duration: 842e6 })}
        range={[0, 100]}
        onRangeChange={change}
      />,
    );
    fireEvent.change(screen.getByRole("slider", { name: "Range start" }), {
      target: { value: "25" },
    });
    expect(change).toHaveBeenCalledWith([25, 100], expect.anything());
    rerender(
      <TraceOverview
        trace={makeTrace({ duration: 842e6 })}
        range={[25, 75]}
        onRangeChange={change}
      />,
    );
    fireEvent.doubleClick(screen.getByRole("group", { name: "Visible time range" }));
    expect(change).toHaveBeenLastCalledWith([0, 100]);
    change.mockClear();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Range start" }), { key: "Escape" });
    expect(change).not.toHaveBeenCalled();
  });
  it("shrinks a selection back to its anchor after dragging starts", () => {
    const change = vi.fn();
    render(<TraceOverview trace={makeTrace()} range={[0, 100]} onRangeChange={change} />);
    const slider = screen.getByRole("group", { name: "Visible time range" });
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      left: 100,
      width: 1000,
    } as DOMRect);
    slider.setPointerCapture = vi.fn();
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 600 });
    expect(change).toHaveBeenLastCalledWith([10, 50]);
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 201 });
    expect(change).toHaveBeenLastCalledWith([10, 10.1]);
  });
  it.each([
    [800, 300, [20, 70]],
    [200, 1200, [10, 100]],
    [600, 0, [0, 50]],
  ])("uses the release coordinate from %s to %s", (from, to, expected) => {
    const change = vi.fn();
    render(<TraceOverview trace={makeTrace()} range={[0, 100]} onRangeChange={change} />);
    const slider = screen.getByRole("group", { name: "Visible time range" });
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      left: 100,
      width: 1000,
    } as DOMRect);
    slider.setPointerCapture = vi.fn();
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: from });
    fireEvent.pointerUp(slider, { pointerId: 1, clientX: to });
    expect(change).toHaveBeenLastCalledWith(expected);
    change.mockClear();
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 500 });
    expect(change).not.toHaveBeenCalled();
  });
  it("ignores clicks and cancelled drags", () => {
    const change = vi.fn();
    render(<TraceOverview trace={makeTrace()} range={[20, 80]} onRangeChange={change} />);
    const slider = screen.getByRole("group", { name: "Visible time range" });
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      left: 100,
      width: 1000,
    } as DOMRect);
    slider.setPointerCapture = vi.fn();
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 200 });
    fireEvent.pointerUp(slider, { pointerId: 1, clientX: 201 });
    expect(change).not.toHaveBeenCalled();
    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 200 });
    fireEvent.pointerCancel(slider, { pointerId: 1 });
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 600 });
    expect(change).not.toHaveBeenCalled();
  });
});
