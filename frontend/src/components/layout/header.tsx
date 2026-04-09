import { useAtomValue, useSetAtom } from "jotai";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  wsStatusAtom,
  traceCountAtom,
  metricCountAtom,
  logCountAtom,
  clearAllAtom,
} from "@/stores/telemetry";

const statusColor: Record<string, string> = {
  connected: "bg-green-500",
  connecting: "bg-yellow-500",
  disconnected: "bg-red-500",
};

export function Header() {
  const wsStatus = useAtomValue(wsStatusAtom);
  const traceCount = useAtomValue(traceCountAtom);
  const metricCount = useAtomValue(metricCountAtom);
  const logCount = useAtomValue(logCountAtom);
  const clearAll = useSetAtom(clearAllAtom);

  const handleClear = async () => {
    await fetch("/api/clear", { method: "DELETE" });
    clearAll();
  };

  return (
    <header className="flex items-center justify-between border-b px-4 py-2">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">otelop</h1>
        <span className="text-xs text-muted-foreground">
          T:{traceCount} M:{metricCount} L:{logCount}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className={`h-2 w-2 rounded-full ${statusColor[wsStatus]}`} />
          <span className="text-xs text-muted-foreground">{wsStatus}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleClear}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
