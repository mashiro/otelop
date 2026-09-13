import { atom, type SetStateAction } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { parseLogSearch, serializeLogTerm, type LogSearchTerm } from "@/lib/log-search";

export type LogFilter = LogSearchTerm & { id: string; enabled: boolean };
export type LogQueryState = { text: string; filters: LogFilter[] };
const initialState: LogQueryState = { text: "", filters: [] };
export const LOG_QUERY_STORAGE_KEY = "otelop.log-query.v1";

export function isLogQueryState(value: unknown): value is LogQueryState {
  if (
    !value ||
    typeof value !== "object" ||
    !("text" in value) ||
    typeof value.text !== "string" ||
    !("filters" in value) ||
    !Array.isArray(value.filters)
  )
    return false;
  return value.filters.every((filter: unknown) => {
    if (!filter || typeof filter !== "object") return false;
    return (
      "id" in filter &&
      typeof filter.id === "string" &&
      "key" in filter &&
      typeof filter.key === "string" &&
      "value" in filter &&
      typeof filter.value === "string" &&
      "resource" in filter &&
      typeof filter.resource === "boolean" &&
      "quoted" in filter &&
      typeof filter.quoted === "boolean" &&
      "negated" in filter &&
      typeof filter.negated === "boolean" &&
      "enabled" in filter &&
      typeof filter.enabled === "boolean"
    );
  });
}

const jsonStorage = createJSONStorage<LogQueryState>(() => window.localStorage);
export const logQueryStateAtom = atomWithStorage<LogQueryState>(
  LOG_QUERY_STORAGE_KEY,
  initialState,
  {
    ...jsonStorage,
    getItem(key, initial) {
      const value = jsonStorage.getItem(key, initial);
      return isLogQueryState(value) ? value : initial;
    },
  },
  { getOnInit: true },
);

export function newLogFilter(term: LogSearchTerm): LogFilter {
  return { ...term, id: crypto.randomUUID(), enabled: true };
}

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
