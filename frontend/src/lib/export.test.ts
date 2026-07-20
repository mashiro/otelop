import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { copyJsonToClipboard, downloadJson } from "./export";

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

  // Store view models (TraceData/LogData/DataPoint) carry a derived bigint
  // epoch field alongside their wire timestamp string — plain
  // JSON.stringify throws on a bigint with no replacer.
  it("does not throw on a record carrying a bigint field, and serializes it as a string", async () => {
    const data = { traceId: "t1", startEpochNs: 1704067200123456789n };

    const ok = await copyJsonToClipboard(data);

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith(
      JSON.stringify({ traceId: "t1", startEpochNs: "1704067200123456789" }, null, 2),
    );
  });
});

describe("downloadJson", () => {
  it("does not throw on a record carrying a bigint field", () => {
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();

    try {
      expect(() =>
        downloadJson({ id: "log-1", epochNs: 1704067200123456789n }, "log-1.json"),
      ).not.toThrow();
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
});
