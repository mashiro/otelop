import { traceFields } from "@/lib/trace-search";
import { SignalAddFilter, SignalFilterBar } from "@/components/filters/signal-filter-bar";

const filterProps = {
  fields: traceFields,
  numericFields: ["duration_ms"],
  signal: "traces" as const,
  label: "Trace filters",
  description:
    "All conditions must match the same span. Child spans are included. Duration is in milliseconds.",
};

export function TraceAddFilter() {
  return <SignalAddFilter {...filterProps} />;
}

export function TraceFilterBar() {
  return <SignalFilterBar {...filterProps} />;
}
