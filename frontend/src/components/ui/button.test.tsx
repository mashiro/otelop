import { describe, expect, it } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";

describe("Button", () => {
  it("applies ghost-muted's hover chrome and muted text color", () => {
    render(<Button variant="ghost-muted">Label</Button>);
    const button = screen.getByRole("button", { name: "Label" });
    expect(button.className).toContain("hover:bg-muted");
    expect(button.className).toContain("hover:text-foreground");
    expect(button.className).toContain("aria-expanded:bg-muted");
    expect(button.className).toContain("aria-expanded:text-foreground");
    expect(button.className).toContain("dark:hover:bg-muted/50");
    expect(button.className).toContain("text-muted-foreground");
  });

  it("applies success's tinted background and stays fully opaque while disabled", () => {
    render(
      <Button variant="success" disabled>
        Live
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Live" });
    expect(button.className).toContain("bg-success/10");
    expect(button.className).toContain("text-success");
    expect(button.className).toContain("hover:bg-success/20");
    expect(button.className).toContain("dark:bg-success/15");
    expect(button.className).toContain("dark:hover:bg-success/25");
    expect(button.className).toContain("disabled:opacity-100");
  });

  it("applies ghost-toggle's hover-only aria-expanded highlight", () => {
    render(<Button variant="ghost-toggle">Toggle</Button>);
    const button = screen.getByRole("button", { name: "Toggle" });
    expect(button.className).toContain("hover:bg-muted");
    expect(button.className).toContain("hover:text-foreground");
    expect(button.className).toContain("aria-expanded:not-hover:bg-transparent");
    expect(button.className).toContain("dark:hover:bg-muted/50");
    // ghost-toggle drops ghost's persistent aria-expanded highlight.
    expect(button.className).not.toContain("aria-expanded:bg-muted");
  });

  it.each([
    ["trace", "text-trace"],
    ["metric", "text-metric"],
    ["log", "text-log"],
  ] as const)("applies tone=%s as %s", (tone, expectedClass) => {
    render(<Button tone={tone}>Label</Button>);
    const button = screen.getByRole("button", { name: "Label" });
    expect(button.className).toContain(expectedClass);
  });

  it("applies no tone color by default", () => {
    render(<Button>Label</Button>);
    const button = screen.getByRole("button", { name: "Label" });
    expect(button.className).not.toContain("text-trace");
    expect(button.className).not.toContain("text-metric");
    expect(button.className).not.toContain("text-log");
  });
});
