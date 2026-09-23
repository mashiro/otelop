import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { SIGNAL_LIST, type SignalKey } from "@/lib/signals";
import { ServerInfoRow } from "./server-info-row";
import { formatDateTime } from "@/lib/format";
import type { ServerInfoQuery } from "@/gql/graphql";

type Status = ServerInfoQuery["status"];

// Literal per-signal classes: Tailwind can't scan `bg-${token}` interpolation.
const signalDot: Record<SignalKey, string> = {
  traces: "bg-trace",
  metrics: "bg-metric",
  logs: "bg-log",
};

function signalCount(config: Status["config"], key: SignalKey): number {
  if (key === "traces") return config.traceCount;
  if (key === "metrics") return config.metricCount;
  return config.logCount;
}

export function SignalsCard({ status }: { status: Status }) {
  const { config, storage } = status;
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle>Signals</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {SIGNAL_LIST.map((signal) => (
            <ServerInfoRow
              key={signal.key}
              label={
                <>
                  <span className={cn("size-1.5 shrink-0 rounded-full", signalDot[signal.key])} />
                  {signal.label}
                </>
              }
              numeric
              value={signalCount(config, signal.key).toLocaleString("en-US")}
            />
          ))}
          <Separator />
          <ServerInfoRow
            label="Oldest"
            mono
            value={storage.oldestTimestamp ? formatDateTime(storage.oldestTimestamp) : "—"}
          />
          <ServerInfoRow
            label="Newest"
            mono
            value={storage.newestTimestamp ? formatDateTime(storage.newestTimestamp) : "—"}
          />
        </div>
      </CardContent>
    </Card>
  );
}
