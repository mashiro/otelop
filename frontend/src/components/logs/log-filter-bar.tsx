import { logFields } from "@/lib/log-search";
import { SignalFilterBar } from "@/components/filters/signal-filter-bar";
export function LogFilterBar() {
  return (
    <SignalFilterBar
      fields={Object.keys(logFields)}
      numericFields={["severity_number"]}
      signal="logs"
      label="Log filters"
    />
  );
}
