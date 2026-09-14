import { describe, it, expect, beforeEach } from "vite-plus/test";
import { createStore } from "jotai";
import {
  traceSearchAtom,
  traceTextSearchAtom,
  traceQueryStateAtom,
  addTraceFilterAtom,
} from "./trace-query";
import {
  applyLocationAtom,
  activeTabAtom,
  metricSearchAtom,
  eventTimeWindowAtom,
  selectedTraceIdAtom,
} from "./navigation";
import { parseTraceSearch } from "@/lib/trace-search";
beforeEach(() => window.history.replaceState(null, "", "/traces"));
describe("signal query URLs", () => {
  it("restores text, disabled filters, detail selection and fixed window", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/traces");
    store.set(eventTimeWindowAtom, {
      mode: "fixed",
      from: "2026-09-14T00:00:00.123456789Z",
      to: "2026-09-14T00:01:00Z",
    });
    store.set(traceSearchAtom, 'diff name:"git diff --check" attributes.日本語:"a&b"');
    store.set(traceQueryStateAtom, (state) => ({
      ...state,
      filters: state.filters.map((filter, i) => ({ ...filter, enabled: i === 0 })),
    }));
    store.set(selectedTraceIdAtom, "abc");
    const url = window.location.href;
    store.set(applyLocationAtom, "/traces");
    expect(store.get(traceSearchAtom)).toBe("");
    store.set(applyLocationAtom, url);
    expect(store.get(traceTextSearchAtom)).toBe("diff");
    expect(store.get(traceQueryStateAtom).filters.map((f) => f.enabled)).toEqual([true, false]);
    expect(store.get(selectedTraceIdAtom)).toBe("abc");
    expect(store.get(eventTimeWindowAtom)).toMatchObject({
      mode: "fixed",
      from: "2026-09-14T00:00:00.123456789Z",
    });
  });
  it("deduplicates detail filters and reenables disabled conditions", () => {
    const store = createStore();
    const term = parseTraceSearch('name:"request"').terms[0];
    store.set(addTraceFilterAtom, term);
    store.set(addTraceFilterAtom, term);
    expect(store.get(traceQueryStateAtom).filters).toHaveLength(1);
    store.set(traceQueryStateAtom, (state) => ({
      ...state,
      filters: state.filters.map((f) => ({ ...f, enabled: false })),
    }));
    store.set(addTraceFilterAtom, term);
    expect(store.get(traceQueryStateAtom).filters[0].enabled).toBe(true);
  });
  it("keeps metric name searches across tab switches and clears on bare URLs", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/metrics");
    store.set(metricSearchAtom, "http.日本語 & duration");
    const url = window.location.href;
    expect(new URL(url).searchParams.get("q")).toBe("http.日本語 & duration");
    store.set(activeTabAtom, "traces");
    expect(new URL(window.location.href).searchParams.get("q")).toBeNull();
    store.set(activeTabAtom, "metrics");
    expect(window.location.href).toBe(url);
    store.set(applyLocationAtom, "/metrics");
    expect(store.get(metricSearchAtom)).toBe("");
    store.set(applyLocationAtom, url);
    expect(store.get(metricSearchAtom)).toBe("http.日本語 & duration");
  });
});
