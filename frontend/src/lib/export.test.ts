import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { copyJsonToClipboard } from "./export";

describe("copyJsonToClipboard", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("copies formatted JSON to clipboard", async () => {
    const data = { key: "value", num: 42 };
    const ok = await copyJsonToClipboard(data);
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });

  it("returns false when clipboard API fails", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const ok = await copyJsonToClipboard({ a: 1 });
    expect(ok).toBe(false);
  });
});
