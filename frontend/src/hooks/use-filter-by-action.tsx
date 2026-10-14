import { metricFields } from "@/lib/metric-search";
import type { ReactNode } from "react";
import { useSignalQueryActions } from "@/hooks/use-signal-route";
import { draftTerm, valueToFilterDraft } from "@/lib/log-filter";
import { traceFields } from "@/lib/trace-search";
import { AddFilterButton } from "@/components/filters/add-filter-button";

export function useFilterByAction(signal: "logs" | "traces" | "metrics") {
  const { addFilter } = useSignalQueryActions(signal);
  const fields =
    signal === "traces" ? traceFields : signal === "metrics" ? metricFields : undefined;

  const filterBy = (key: string, value: unknown) => {
    void addFilter(draftTerm(valueToFilterDraft(key, value), fields));
  };

  const filterAction = (key: string, value: unknown): ReactNode => (
    <AddFilterButton label={`Filter by ${key}`} onClick={() => filterBy(key, value)} />
  );

  return { filterBy, filterAction };
}
