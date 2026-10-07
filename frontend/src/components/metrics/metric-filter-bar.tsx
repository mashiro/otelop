import { metricFields } from "@/lib/metric-search";
import { SignalAddFilter, SignalFilterBar } from "@/components/filters/signal-filter-bar";

const filterProps = {
  fields: metricFields,
  numericFields: [],
  signal: "metrics" as const,
  label: "Metric filters",
  description:
    "All conditions must match the same series. Matching metrics include all their series.",
};

export function MetricAddFilter() {
  return <SignalAddFilter {...filterProps} />;
}

export function MetricFilterBar() {
  return <SignalFilterBar {...filterProps} />;
}
