import { createFilterQueryAtoms } from "./log-query";
import { traceQueryStateAtom } from "./navigation";
import { parseTraceSearch } from "@/lib/trace-search";
export { traceQueryStateAtom } from "./navigation";
export const {
  addFilterAtom: addTraceFilterAtom,
  searchAtom: traceSearchAtom,
  textSearchAtom: traceTextSearchAtom,
} = createFilterQueryAtoms(traceQueryStateAtom, parseTraceSearch);
