import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createStore } from "jotai";
import {
  LOG_QUERY_STORAGE_KEY,
  logQueryStateAtom,
  logSearchAtom,
  logTextSearchAtom,
  newLogFilter,
} from "./log-query";
import { draftTerm, filterDraft } from "@/lib/log-filter";
import { parseLogSearch, serializeLogTerm } from "@/lib/log-search";
beforeEach(() => window.localStorage.removeItem(LOG_QUERY_STORAGE_KEY));

describe("log filter state", () => {
  it("keeps text independent and persists disabled conditions", () => {
    const store = createStore();
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
    expect(JSON.parse(window.localStorage.getItem(LOG_QUERY_STORAGE_KEY)!)).toMatchObject({
      filters: [{ enabled: false }],
    });
  });
  it("restores automatically without a saved-search name", () => {
    const store = createStore();
    store.set(logSearchAtom, '-attributes.http.method:"GET"');
    const reopened = createStore();
    const unsubscribe = reopened.sub(logQueryStateAtom, () => {});
    expect(reopened.get(logSearchAtom)).toBe('-attributes.http.method:"GET"');
    unsubscribe();
  });
  it("clears all conditions for surrounding-log navigation", () => {
    const store = createStore();
    store.set(logSearchAtom, "failed attributes.http.method:GET");
    store.set(logSearchAtom, "");
    expect(store.get(logQueryStateAtom)).toEqual({ text: "", filters: [] });
  });
  it("ignores malformed persisted state", () => {
    window.localStorage.setItem(LOG_QUERY_STORAGE_KEY, '{"text":true,"filters":[null]}');
    const store = createStore();
    const unsubscribe = store.sub(logQueryStateAtom, () => {});
    expect(store.get(logSearchAtom)).toBe("");
    unsubscribe();
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
