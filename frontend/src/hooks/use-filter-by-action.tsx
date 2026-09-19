import type { ReactNode } from "react";
import { useSignalQuery } from "@/hooks/use-signal-route";
import { draftTerm, valueToFilterDraft } from "@/lib/log-filter";
import { traceFields } from "@/lib/trace-search";
import { AddFilterButton } from "@/components/filters/add-filter-button";

// Shared by SpanDetail (trace-detail.tsx) and LogDetail (log-list.tsx): both
// let every detail field render an "add as filter" action for its own
// value. Only the field list passed to draftTerm differs between the two
// signals (traces validate against traceFields; logs use draftTerm's
// default), so that's the only thing branched on here.
export function useFilterByAction(signal: "logs" | "traces") {
  const { addFilter } = useSignalQuery(signal);
  const fields = signal === "traces" ? traceFields : undefined;

  const filterBy = (key: string, value: unknown) => {
    void addFilter(draftTerm(valueToFilterDraft(key, value), fields));
  };

  const filterAction = (key: string, value: unknown): ReactNode => (
    <AddFilterButton label={`Filter by ${key}`} onClick={() => filterBy(key, value)} />
  );

  return { filterBy, filterAction };
}
