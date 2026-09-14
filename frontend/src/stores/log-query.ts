import { atom, type PrimitiveAtom, type SetStateAction } from "jotai";
import { parseLogSearch, serializeLogTerm, type LogSearchTerm } from "@/lib/log-search";
import { newLogFilter, type LogQueryState } from "@/lib/log-query-state";
import { logQueryStateAtom } from "./navigation";
export { logQueryStateAtom } from "./navigation";
export { newLogFilter, type LogFilter, type LogQueryState } from "@/lib/log-query-state";

export const {
  addFilterAtom: addLogFilterAtom,
  searchAtom: logSearchAtom,
  textSearchAtom: logTextSearchAtom,
} = createFilterQueryAtoms(logQueryStateAtom, parseLogSearch);

export function createFilterQueryAtoms(
  queryStateAtom: PrimitiveAtom<LogQueryState>,
  parse: typeof parseLogSearch,
) {
  const addFilterAtom = atom(null, (get, set, term: LogSearchTerm) => {
    const state = get(queryStateAtom);
    const query = serializeLogTerm(term);
    const existing = state.filters.find((filter) => serializeLogTerm(filter) === query);
    set(queryStateAtom, {
      ...state,
      filters: existing
        ? state.filters.map((filter) =>
            filter.id === existing.id ? { ...filter, enabled: true } : filter,
          )
        : [...state.filters, newLogFilter(term)],
    });
  });

  const searchAtom = atom(
    (get) => {
      const state = get(queryStateAtom);
      return [state.text, ...state.filters.filter((filter) => filter.enabled).map(serializeLogTerm)]
        .filter(Boolean)
        .join(" ");
    },
    (get, set, update: SetStateAction<string>) => {
      const search = typeof update === "function" ? update(get(searchAtom)) : update;
      const { plain, terms } = parse(search);
      set(queryStateAtom, { text: plain, filters: terms.map(newLogFilter) });
    },
  );

  const textSearchAtom = atom(
    (get) => get(queryStateAtom).text,
    (get, set, update: SetStateAction<string>) => {
      const state = get(queryStateAtom);
      const search = typeof update === "function" ? update(state.text) : update;
      const { plain, terms } = parse(search);
      set(queryStateAtom, {
        text: plain,
        filters: [...state.filters, ...terms.map(newLogFilter)],
      });
    },
  );

  return { addFilterAtom, searchAtom, textSearchAtom };
}
