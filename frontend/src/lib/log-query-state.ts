import type { SignalSearch } from "./route-search";
import { parseLogSearch, serializeLogTerm, type LogSearchTerm } from "./log-search";

export type LogFilter = LogSearchTerm & { id: string; enabled: boolean };
export type LogQueryState = { text: string; filters: LogFilter[] };

export function newLogFilter(term: LogSearchTerm): LogFilter {
  return { ...term, id: crypto.randomUUID(), enabled: true };
}

export function readFilterQuery(search: SignalSearch, fields?: readonly string[]): LogQueryState {
  const filters: LogFilter[] = [];
  const occurrences = new Map<string, number>();
  for (const enabled of [true, false]) {
    for (const value of (enabled ? search.filter : search.disabled_filter) ?? []) {
      const parsed = parseLogSearch(value, fields);
      if (parsed.plain || parsed.terms.length !== 1) continue;
      const occurrence = occurrences.get(value) ?? 0;
      occurrences.set(value, occurrence + 1);
      filters.push({ ...parsed.terms[0], id: JSON.stringify([value, occurrence]), enabled });
    }
  }
  return { text: search.q ?? "", filters };
}

export function filterQuerySearch(
  state: LogQueryState,
): Pick<SignalSearch, "q" | "filter" | "disabled_filter"> {
  return {
    q: state.text || undefined,
    filter: state.filters.filter((filter) => filter.enabled).map(serializeLogTerm),
    disabled_filter: state.filters.filter((filter) => !filter.enabled).map(serializeLogTerm),
  };
}
