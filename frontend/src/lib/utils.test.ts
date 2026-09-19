import { describe, it, expect } from "vite-plus/test";
import { cn } from "./utils";

// The `@theme` block in index.css declares custom tokens (`--text-3xs`,
// `--text-2xs`, `--shadow-glow`, `--drop-shadow-glow`) that plain twMerge
// doesn't know about, so it misclassifies them against the built-in
// font-size/shadow-color groups and silently drops one of two classes that
// should both survive. These tests pin the merge behavior `cn()` must
// produce once it's taught about those tokens.
describe("cn", () => {
  it("keeps a custom text-3xs size alongside a text color utility", () => {
    const result = cn("text-3xs", "text-muted-foreground");
    expect(result).toContain("text-3xs");
    expect(result).toContain("text-muted-foreground");
  });

  it("keeps a custom text-2xs size alongside a text color utility", () => {
    const result = cn("text-2xs", "text-foreground");
    expect(result).toContain("text-2xs");
    expect(result).toContain("text-foreground");
  });

  it("still resolves conflicts within the text-size group: a later custom size wins", () => {
    const classes = cn("text-xs", "text-3xs").split(/\s+/).filter(Boolean);
    expect(classes).not.toContain("text-xs");
    expect(classes).toContain("text-3xs");
  });

  it("keeps the custom shadow-glow shape alongside a shadow color utility", () => {
    const result = cn("shadow-glow", "shadow-trace/20");
    expect(result).toContain("shadow-glow");
    expect(result).toContain("shadow-trace/20");
  });

  it("keeps both under a shared data-active variant prefix", () => {
    const result = cn("data-active:shadow-glow", "data-active:shadow-trace/20");
    expect(result).toContain("data-active:shadow-glow");
    expect(result).toContain("data-active:shadow-trace/20");
  });

  it("keeps the custom drop-shadow-glow shape alongside a drop-shadow color utility", () => {
    const result = cn("drop-shadow-glow", "drop-shadow-success/70");
    expect(result).toContain("drop-shadow-glow");
    expect(result).toContain("drop-shadow-success/70");
  });
});
