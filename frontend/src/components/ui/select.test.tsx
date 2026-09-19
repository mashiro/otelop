import { describe, it, expect, afterEach } from "vite-plus/test";
import { render, cleanup } from "@testing-library/react";
import { Select, SelectTrigger, SelectValue } from "./select";

afterEach(cleanup);

// SelectTrigger renders directly inside the trigger (SelectContent is the
// only portaled part of Base UI's Select), so it can be queried straight
// from the render container without opening the popup.
function renderTrigger(props: React.ComponentProps<typeof SelectTrigger>) {
  const { container } = render(
    <Select items={[{ value: "a", label: "A" }]} defaultValue="a">
      <SelectTrigger {...props}>
        <SelectValue />
      </SelectTrigger>
    </Select>,
  );
  return container.querySelector('[data-slot="select-trigger"]') as HTMLElement;
}

describe("SelectTrigger", () => {
  it("defaults to the neutral focus ring and default variant", () => {
    const trigger = renderTrigger({});

    expect(trigger.className).toContain("focus-visible:border-ring");
    expect(trigger.className).toContain("focus-visible:ring-ring/50");
    expect(trigger.className).not.toContain("bg-muted/50");
  });

  it.each([
    ["trace", "focus-visible:border-trace/60", "focus-visible:ring-trace/20"],
    ["metric", "focus-visible:border-metric/60", "focus-visible:ring-metric/20"],
    ["log", "focus-visible:border-log/60", "focus-visible:ring-log/20"],
  ] as const)(
    "applies the %s tone's focus ring and drops the neutral one",
    (tone, border, ring) => {
      const trigger = renderTrigger({ tone });

      expect(trigger.className).toContain(border);
      expect(trigger.className).toContain(ring);
      expect(trigger.className).not.toContain("focus-visible:border-ring");
      expect(trigger.className).not.toContain("focus-visible:ring-ring/50");
    },
  );

  it("applies the muted variant's background and typography", () => {
    const trigger = renderTrigger({ variant: "muted" });

    expect(trigger.className).toContain("bg-muted/50");
    expect(trigger.className).toContain("text-xs");
    expect(trigger.className).toContain("font-medium");
  });

  it.each([
    ["default", "data-[size=default]:h-8"],
    ["sm", "data-[size=sm]:h-7"],
  ] as const)("sets data-size=%s and keeps the matching height class", (size, expectedClass) => {
    const trigger = renderTrigger({ size });

    expect(trigger.getAttribute("data-size")).toBe(size);
    expect(trigger.className).toContain(expectedClass);
  });

  it("merges a caller className alongside the variant classes", () => {
    const trigger = renderTrigger({ tone: "trace", variant: "muted", className: "min-w-18" });

    expect(trigger.className).toContain("min-w-18");
    expect(trigger.className).toContain("bg-muted/50");
    expect(trigger.className).toContain("focus-visible:border-trace/60");
  });
});
