import { logFields } from "@/lib/log-search";
import { SignalAddFilter, SignalFilterBar } from "@/components/filters/signal-filter-bar";

const filterProps = {
  fields: Object.keys(logFields),
  numericFields: ["severity_number"],
  signal: "logs" as const,
  label: "Log filters",
};

export function LogAddFilter() {
  return <SignalAddFilter {...filterProps} />;
}

export function LogFilterBar() {
  return <SignalFilterBar {...filterProps} />;
}
