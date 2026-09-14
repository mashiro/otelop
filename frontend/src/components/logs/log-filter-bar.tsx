import { logQueryStateAtom } from "@/stores/log-query";
import { logFields } from "@/lib/log-search";
import { SignalFilterBar } from "@/components/filters/signal-filter-bar";
export function LogFilterBar() {
  return (
    <SignalFilterBar
      queryAtom={logQueryStateAtom}
      fields={Object.keys(logFields)}
      numericFields={["severity_number"]}
      signal="logs"
      label="Log filters"
    />
  );
}
