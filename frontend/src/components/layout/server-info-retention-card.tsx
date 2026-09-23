import { Item, ItemHeader, ItemTitle, ItemContent } from "@/components/ui/item";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { HelpTooltip } from "@/components/common/help-tooltip";
import { ServerInfoRow } from "./server-info-row";
import { formatDateTime, formatElapsedMs, formatRelativeTime } from "@/lib/format";
import type { ServerInfoQuery } from "@/gql/graphql";

type StorageStatus = ServerInfoQuery["status"]["storage"];

export function RetentionCard({
  config,
  storage,
}: {
  config: ServerInfoQuery["status"]["config"];
  storage: StorageStatus;
}) {
  const sweep = storage.lastSweep;
  return (
    <Item variant="muted" className="min-w-0 flex-col items-stretch">
      <ItemHeader className="basis-auto flex-col items-start">
        <ItemTitle>Retention</ItemTitle>
      </ItemHeader>
      <ItemContent>
        <div className="flex flex-col gap-2">
          <ServerInfoRow label="Retention" mono value={config.retention} />
          <ServerInfoRow
            label="Sweep interval"
            mono
            value={`every ${formatElapsedMs(storage.sweepIntervalMs)}`}
          />
          <ServerInfoRow
            label="Next sweep"
            value={
              storage.nextSweepAt ? (
                <HelpTooltip content={formatDateTime(storage.nextSweepAt)}>
                  <span className="cursor-default tabular-nums">
                    {formatRelativeTime(storage.nextSweepAt)}
                  </span>
                </HelpTooltip>
              ) : (
                "—"
              )
            }
          />
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="shrink-0 text-muted-foreground">Last sweep</span>
            {sweep ? (
              <span className="text-right text-foreground">
                {formatRelativeTime(sweep.startedAt)} · deleted{" "}
                {sweep.deletedRows.toLocaleString("en-US")} rows in{" "}
                {formatElapsedMs(sweep.durationMs)}
              </span>
            ) : (
              <span className="text-muted-foreground">Not run yet</span>
            )}
          </div>
          {sweep && sweep.maxSizeIterations > 0 && (
            <ServerInfoRow label="Max-size iterations" numeric value={sweep.maxSizeIterations} />
          )}
          {sweep?.error && (
            <Alert variant="destructive">
              <AlertDescription>{sweep.error}</AlertDescription>
            </Alert>
          )}
        </div>
      </ItemContent>
    </Item>
  );
}
