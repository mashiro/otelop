import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createStore } from "jotai";
import { logQueryStateAtom, logSearchAtom, logTextSearchAtom, newLogFilter } from "./log-query";
import { draftTerm, filterDraft } from "@/lib/log-filter";
import { parseLogSearch, serializeLogTerm } from "@/lib/log-search";
beforeEach(() => window.history.replaceState(null, "", "/logs"));
import {
  activeTabAtom,
  applyLocationAtom,
  eventTimeWindowAtom,
  selectedLogIdAtom,
} from "./navigation";
import { readLogQuery } from "@/lib/log-query-state";
import { navigateToLogsAtom } from "./telemetry";

describe("log filter state", () => {
  it("keeps text independent and persists disabled conditions", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/logs");
    const filter = newLogFilter(
      draftTerm({ key: "attributes.http.status_code", operator: ">=", value: "500" }),
    );
    store.set(logQueryStateAtom, { text: "failed", filters: [filter] });
    expect(store.get(logSearchAtom)).toBe("failed attributes.http.status_code:>=500");
    store.set(logTextSearchAtom, "");
    expect(store.get(logSearchAtom)).toBe("attributes.http.status_code:>=500");
    store.set(logQueryStateAtom, { text: "", filters: [{ ...filter, enabled: false }] });
    expect(store.get(logSearchAtom)).toBe("");
    expect(store.get(logQueryStateAtom).filters).toHaveLength(1);
    expect(readLogQuery(window.location.href)).toMatchObject({
      filters: [{ enabled: false }],
    });
  });
  it("restores automatically without a saved-search name", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/logs");
    store.set(logSearchAtom, '-attributes.http.method:"GET"');
    const reopened = createStore();
    reopened.set(applyLocationAtom, window.location.href);
    expect(reopened.get(logSearchAtom)).toBe('-attributes.http.method:"GET"');
  });
  it("clears all conditions for surrounding-log navigation", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/logs");
    store.set(logSearchAtom, "failed attributes.http.method:GET");
    store.set(logSearchAtom, "");
    expect(store.get(logQueryStateAtom)).toEqual({ text: "", filters: [] });
  });
  it("ignores malformed URL filters and clears conditions on a bare URL", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/logs?filter=invalid&disabled_filter=attributes.foo:");
    expect(store.get(logSearchAtom)).toBe("");
    store.set(logSearchAtom, "trace_id:abc");
    store.set(applyLocationAtom, "/logs");
    expect(store.get(logSearchAtom)).toBe("");
  });
  it("round trips special characters, disabled filters, fixed time bounds and log selection", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/logs");
    store.set(eventTimeWindowAtom, {
      mode: "fixed",
      from: "2026-09-14T00:00:00Z",
      to: "2026-09-14T00:01:00Z",
    });
    const filter = newLogFilter(
      draftTerm({
        key: "attributes.arguments",
        operator: "is",
        value: '{"cmd":"日本語 & + # "test""}',
      }),
    );
    store.set(logQueryStateAtom, {
      text: "diff & + # 日本語",
      filters: [{ ...filter, enabled: false }],
    });
    store.set(selectedLogIdAtom, "log-1");
    const url = window.location.href;
    const restored = createStore();
    restored.set(applyLocationAtom, url);
    expect(restored.get(logQueryStateAtom)).toMatchObject({
      text: "diff & + # 日本語",
      filters: [{ enabled: false, value: filter.value }],
    });
    expect(restored.get(eventTimeWindowAtom)).toEqual(store.get(eventTimeWindowAtom));
    expect(restored.get(selectedLogIdAtom)).toBe("log-1");
    store.set(activeTabAtom, "traces");
    store.set(activeTabAtom, "logs");
    expect(window.location.href).toBe(url);
  });
  it("restores earlier query state without pushing another history entry", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/logs");
    store.set(logSearchAtom, "trace_id:abc");
    const earlier = window.location.href;
    store.set(logSearchAtom, "trace_id:def");
    const length = window.history.length;
    store.set(applyLocationAtom, earlier);
    expect(store.get(logSearchAtom)).toBe("trace_id:abc");
    expect(window.history.length).toBe(length);
  });
  it("adds trace navigation as a removable filter, preserving other conditions", () => {
    const store = createStore();
    store.set(applyLocationAtom, "/traces/abc");
    store.set(logSearchAtom, "severity_text:ERROR");
    store.set(navigateToLogsAtom, "abc");
    expect(store.get(activeTabAtom)).toBe("logs");
    expect(store.get(logSearchAtom)).toBe('severity_text:ERROR trace_id:"abc"');
    expect(readLogQuery(window.location.href).filters).toHaveLength(2);
    store.set(activeTabAtom, "traces");
    store.set(navigateToLogsAtom, "abc");
    expect(store.get(logQueryStateAtom).filters).toHaveLength(2);
    store.set(logQueryStateAtom, (state) => ({
      ...state,
      filters: state.filters.filter((f) => f.field !== "trace_id"),
    }));
    expect(store.get(logSearchAtom)).toBe("severity_text:ERROR");
  });
  it.each([
    { key: "attributes.user.name", operator: "contains" as const, value: 'Alice "Smith"' },
    { key: "resource.service.name", operator: "is_not" as const, value: "worker" },
    { key: "attributes.http.status_code", operator: ">=" as const, value: "500" },
    { key: "attributes.error.type", operator: "not_exists" as const, value: "" },
  ])("round trips a visual condition: $operator", (draft) => {
    const term = draftTerm(draft);
    expect(parseLogSearch(serializeLogTerm(term)).terms).toEqual([term]);
    expect(filterDraft(term)).toEqual(draft);
  });
});
