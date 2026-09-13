import { parseLogSearch, serializeLogTerm, type LogSearchTerm } from "./log-search";

export type LogFilter = LogSearchTerm & { id: string; enabled: boolean };
export type LogQueryState = { text: string; filters: LogFilter[] };

export function newLogFilter(term: LogSearchTerm): LogFilter {
  return { ...term, id: crypto.randomUUID(), enabled: true };
}

export function readLogQuery(location: string): LogQueryState {
  const url = new URL(location, "http://otelop.invalid");
  if (url.pathname.split("/")[1] !== "logs") return { text: "", filters: [] };
  const filters: LogFilter[] = [];
  for (const [key, value] of url.searchParams) {
    if (key !== "filter" && key !== "disabled_filter") continue;
    const parsed = parseLogSearch(value);
    if (parsed.plain || parsed.terms.length !== 1) continue;
    filters.push({ ...newLogFilter(parsed.terms[0]), enabled: key === "filter" });
  }
  return { text: url.searchParams.get("q") ?? "", filters };
}

export function writeLogQuery(url: URL, state: LogQueryState): void {
  url.searchParams.delete("q");
  url.searchParams.delete("filter");
  url.searchParams.delete("disabled_filter");
  if (state.text) url.searchParams.set("q", state.text);
  for (const filter of state.filters) {
    url.searchParams.append(
      filter.enabled ? "filter" : "disabled_filter",
      serializeLogTerm(filter),
    );
  }
}
