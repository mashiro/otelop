import { describe, it, expect, afterEach } from "vite-plus/test";
import { render, screen, cleanup } from "@testing-library/react";
import { TimeRangeSelect } from "./time-range-select";

afterEach(cleanup);

describe("TimeRangeSelect", () => {
  // Base UI's Select.Value shows the selected item's raw value unless an
  // `items` map is passed — without it, "all" and "custom" showed up
  // lowercase in the trigger instead of their "All"/"Custom" labels.
  it("shows the 'All' label (not the raw 'all' value) when range is all", () => {
    render(<TimeRangeSelect range="all" onRangeChange={() => {}} tone="trace" />);

    expect(screen.getByText("All")).toBeTruthy();
    expect(screen.queryByText("all")).toBeNull();
  });

  it("shows '1h' when range is 1h", () => {
    render(<TimeRangeSelect range="1h" onRangeChange={() => {}} tone="trace" />);

    expect(screen.getByText("1h")).toBeTruthy();
  });

  it("shows the 'Custom' label when range is null", () => {
    render(<TimeRangeSelect range={null} onRangeChange={() => {}} tone="trace" />);

    expect(screen.getByText("Custom")).toBeTruthy();
  });
});
