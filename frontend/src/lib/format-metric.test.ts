import { describe, it, expect } from "vitest";
import { formatMetricValue } from "./format-metric";

describe("formatMetricValue", () => {
  describe("bytes (By)", () => {
    it("keeps small values as B", () => {
      expect(formatMetricValue(0, "By")).toBe("0.00 B");
      expect(formatMetricValue(512, "By")).toBe("512 B");
    });

    it("scales to KiB/MiB/GiB with 1024 base", () => {
      expect(formatMetricValue(2048, "By")).toBe("2.00 KiB");
      expect(formatMetricValue(1024 * 1024, "By")).toBe("1.00 MiB");
      expect(formatMetricValue(1024 * 1024 * 1024, "By")).toBe("1.00 GiB");
    });

    it("keeps sign for negative values", () => {
      expect(formatMetricValue(-2048, "By")).toBe("-2.00 KiB");
    });

    it("handles By/s", () => {
      expect(formatMetricValue(2048, "By/s")).toBe("2.00 KiB/s");
    });
  });

  describe("seconds (s)", () => {
    it("sub-second values use ms", () => {
      expect(formatMetricValue(0.5, "s")).toBe("500 ms");
      expect(formatMetricValue(0.025, "s")).toBe("25.0 ms");
    });

    it("micro values use μs", () => {
      expect(formatMetricValue(0.00015, "s")).toBe("150 μs");
    });

    it("1..60 seconds use s", () => {
      expect(formatMetricValue(2.3, "s")).toBe("2.30 s");
      expect(formatMetricValue(45, "s")).toBe("45.0 s");
    });

    it("minutes and beyond use m/s", () => {
      expect(formatMetricValue(125, "s")).toBe("2m 5s");
    });

    it("handles zero explicitly", () => {
      expect(formatMetricValue(0, "s")).toBe("0 s");
    });
  });

  describe("milliseconds (ms)", () => {
    it("sub-millisecond uses μs", () => {
      expect(formatMetricValue(0.5, "ms")).toBe("500 μs");
    });

    it("1..1000 ms uses ms", () => {
      expect(formatMetricValue(250, "ms")).toBe("250 ms");
    });

    it("≥1000 ms uses s", () => {
      expect(formatMetricValue(1500, "ms")).toBe("1.50 s");
    });
  });

  describe("dimensionless", () => {
    it("empty unit returns compact number only", () => {
      expect(formatMetricValue(42, "")).toBe("42");
      expect(formatMetricValue(1234, "")).toMatch(/^1\.2\s*K$/);
    });

    it("'1' unit returns compact number only", () => {
      expect(formatMetricValue(0.73, "1")).toBe("0.7");
    });
  });

  describe("curly-brace annotation units", () => {
    it("strips braces and appends label", () => {
      expect(formatMetricValue(1500, "{request}")).toMatch(/^1\.5\s*K request$/);
      expect(formatMetricValue(42, "{token}")).toBe("42 token");
    });
  });

  describe("unknown units", () => {
    it("appends raw unit after compact number", () => {
      expect(formatMetricValue(100, "USD")).toBe("100 USD");
    });
  });

  describe("non-finite values", () => {
    it("returns NaN / Infinity as-is", () => {
      expect(formatMetricValue(Number.NaN, "s")).toBe("NaN");
      expect(formatMetricValue(Number.POSITIVE_INFINITY, "By")).toBe("Infinity");
    });
  });
});
