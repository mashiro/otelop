import { describe, it, expect, vi } from "vite-plus/test";
import { Temporal } from "temporal-polyfill";
import { cachedEpochNanos } from "./epoch-cache";

describe("cachedEpochNanos", () => {
  it("parses the timestamp into epoch nanoseconds", () => {
    const item = { timestamp: "2024-01-01T00:00:00Z" };

    const ns = cachedEpochNanos(item, item.timestamp);

    expect(ns).toBe(Temporal.Instant.from(item.timestamp).epochNanoseconds);
  });

  it("caches by object identity: a second call for the same object reuses the cached value", () => {
    const fromSpy = vi.spyOn(Temporal.Instant, "from");
    const item = { timestamp: "2024-01-01T00:00:00Z" };

    cachedEpochNanos(item, item.timestamp);
    const callsAfterFirst = fromSpy.mock.calls.length;
    cachedEpochNanos(item, item.timestamp);

    expect(fromSpy.mock.calls.length).toBe(callsAfterFirst);
    fromSpy.mockRestore();
  });

  it("does not share the cache across distinct objects with the same timestamp", () => {
    const a = { timestamp: "2024-01-01T00:00:00Z" };
    const b = { timestamp: "2024-01-01T00:00:00Z" };

    expect(cachedEpochNanos(a, a.timestamp)).toBe(cachedEpochNanos(b, b.timestamp));

    const fromSpy = vi.spyOn(Temporal.Instant, "from");
    cachedEpochNanos(b, b.timestamp);
    // b was already cached by the assertion above, so this call must not re-parse.
    expect(fromSpy).not.toHaveBeenCalled();
    fromSpy.mockRestore();
  });

  it("keeps nanosecond precision (does not truncate the way Date.parse would)", () => {
    const item = { timestamp: "2024-01-01T00:00:00.123456789Z" };

    const ns = cachedEpochNanos(item, item.timestamp);

    expect(ns % 1_000_000n).toBe(456_789n);
  });

  it("a fresh object (e.g. after an immutable update) is not stale from a prior object's cache", () => {
    const original = { timestamp: "2024-01-01T00:00:00Z" };
    cachedEpochNanos(original, original.timestamp);

    const updated = { ...original, timestamp: "2024-06-01T00:00:00Z" };
    const ns = cachedEpochNanos(updated, updated.timestamp);

    expect(ns).toBe(Temporal.Instant.from("2024-06-01T00:00:00Z").epochNanoseconds);
  });
});
