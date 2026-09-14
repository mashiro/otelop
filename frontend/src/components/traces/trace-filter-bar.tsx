import { traceQueryStateAtom } from "@/stores/trace-query";
import { traceFields } from "@/lib/trace-search";
import { SignalFilterBar } from "@/components/filters/signal-filter-bar";
export function TraceFilterBar() {
  return (
    <SignalFilterBar
      queryAtom={traceQueryStateAtom}
      fields={traceFields}
      numericFields={["duration_ms"]}
      signal="traces"
      label="Trace filters"
      description="All conditions must match the same span. Child spans are included. Duration is in milliseconds."
    />
  );
}
