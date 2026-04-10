import { describe, it, expect, vi, beforeEach } from "vitest";
import { copyJsonToClipboard, downloadJson } from "./export";

describe("copyJsonToClipboard", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("copies formatted JSON to clipboard", async () => {
    const data = { key: "value", num: 42 };
    const ok = await copyJsonToClipboard(data);
    expect(ok).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });

  it("returns false when clipboard API fails", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const ok = await copyJsonToClipboard({ a: 1 });
    expect(ok).toBe(false);
  });
});

describe("downloadJson", () => {
  it("creates a blob with correct JSON content", () => {
    const data = { foo: "bar" };
    const anchors: { href: string; download: string; click: () => void }[] = [];

    const createObjectURL = vi.fn().mockReturnValue("blob:test");
    const revokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;

    const origCreateElement = globalThis.document?.createElement;
    // Provide minimal document.createElement stub if missing
    if (!globalThis.document) {
      (globalThis as Record<string, unknown>).document = {};
    }
    (globalThis.document as Record<string, unknown>).createElement = (tag: string) => {
      if (tag === "a") {
        const anchor = { href: "", download: "", click: vi.fn() };
        anchors.push(anchor);
        return anchor;
      }
      return origCreateElement?.call(document, tag);
    };

    downloadJson(data, "test.json");

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("test.json");
    expect(anchors[0].click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
