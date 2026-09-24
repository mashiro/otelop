import { describe, it, expect } from "vite-plus/test";
import { endpointFor } from "./endpoint";

describe("endpointFor", () => {
  it.each(["0.0.0.0:4317", ":4317", "[::]:4317", "127.0.0.1:4317", "[::1]:4317"])(
    "pairs the browser host with the port of %s",
    (bind) => {
      expect(endpointFor(bind, "otelop.lan")).toBe("otelop.lan:4317");
    },
  );

  it("keeps a bracketed IPv6 browser host as-is", () => {
    expect(endpointFor("0.0.0.0:4318", "[fe80::1]")).toBe("[fe80::1]:4318");
  });
});
