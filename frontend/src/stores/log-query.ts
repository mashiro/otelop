import { atom, type SetStateAction } from "jotai";
import { parseLogSearch, serializeLogTerm, type LogSearchTerm } from "@/lib/log-search";
import { newLogFilter } from "@/lib/log-query-state";
import { logQueryStateAtom } from "./navigation";
export { logQueryStateAtom } from "./navigation";
export { newLogFilter, type LogFilter, type LogQueryState } from "@/lib/log-query-state";

export const addLogFilterAtom = atom(null, (get, set, term: LogSearchTerm) => {
  const state = get(logQueryStateAtom);
  const query = serializeLogTerm(term);
  const existing = state.filters.find((filter) => serializeLogTerm(filter) === query);
  set(logQueryStateAtom, {
    ...state,
    filters: existing
      ? state.filters.map((filter) =>
          filter.id === existing.id ? { ...filter, enabled: true } : filter,
        )
      : [...state.filters, newLogFilter(term)],
  });
});

export const logSearchAtom = atom(
  (get) => {
    const state = get(logQueryStateAtom);
    return [state.text, ...state.filters.filter((filter) => filter.enabled).map(serializeLogTerm)]
      .filter(Boolean)
      .join(" ");
  },
  (get, set, update: SetStateAction<string>) => {
    const search = typeof update === "function" ? update(get(logSearchAtom)) : update;
    const { plain, terms } = parseLogSearch(search);
    set(logQueryStateAtom, { text: plain, filters: terms.map(newLogFilter) });
  },
);

export const logTextSearchAtom = atom(
  (get) => get(logQueryStateAtom).text,
  (get, set, update: SetStateAction<string>) => {
    const state = get(logQueryStateAtom);
    const search = typeof update === "function" ? update(state.text) : update;
    const { plain, terms } = parseLogSearch(search);
    set(logQueryStateAtom, {
      text: plain,
      filters: [...state.filters, ...terms.map(newLogFilter)],
    });
  },
);
