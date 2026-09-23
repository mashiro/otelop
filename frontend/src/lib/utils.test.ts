import { describe, it, expect } from "vite-plus/test";
import { cn } from "./utils";

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
});
