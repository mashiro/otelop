import { describe, it, expect } from "vite-plus/test";
import { reachableEndpoint } from "./endpoint";

describe("reachableEndpoint", () => {
  it.each([
    ["0.0.0.0:4317", "http://localhost:4317"],
    [":4319", "http://localhost:4319"],
    ["[::]:4318", "http://localhost:4318"],
  ])("replaces the wildcard host in %s with the browser host", (bind, want) => {
    expect(reachableEndpoint(bind, "localhost")).toBe(want);
  });

  it("keeps an explicitly bound host", () => {
    expect(reachableEndpoint("127.0.0.1:4318", "otelop.lan")).toBe("http://127.0.0.1:4318");
    expect(reachableEndpoint("[::1]:4317", "otelop.lan")).toBe("http://[::1]:4317");
  });

  it("uses a bracketed IPv6 browser host as-is", () => {
    expect(reachableEndpoint("0.0.0.0:4317", "[fe80::1]")).toBe("http://[fe80::1]:4317");
  });
});
