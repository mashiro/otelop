import type { ReactNode } from "react";
import { Item, ItemActions, ItemContent } from "@/components/ui/item";
import { CopyButton } from "@/components/common/copy-button";
import { copyTextToClipboard } from "@/lib/export";
import { HelpTooltip } from "@/components/common/help-tooltip";
import { formatBytes } from "@/lib/format-metric";
import { formatDateTime, formatElapsedMs, formatRelativeTime } from "@/lib/format";
import { SIGNAL_LIST, type SignalKey } from "@/lib/signals";
import { cn } from "@/lib/utils";
import type { ServerInfoQuery } from "@/gql/graphql";
import { ServerInfoRow } from "./server-info-row";
import { ServerInfoSection, SweepErrorAlert } from "./server-info-section";

type Status = ServerInfoQuery["status"];

// Inserts <wbr> after each "/" so a long path wraps only at directory
// boundaries, never mid-segment.
function pathSegments(path: string): ReactNode[] {
  const parts = path.split("/");
  const nodes: ReactNode[] = [parts[0]];
  for (let i = 1; i < parts.length; i++) {
    nodes.push("/", <wbr key={i} />, parts[i]);
  }
  return nodes;
}

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

export function StoragePanel({ status }: { status: Status }) {
  const { storage, config } = status;
  const path = config.storagePath;
  const sweep = storage.lastSweep;

  return (
    <div className="flex flex-col gap-4">
      <ServerInfoSection title="Database file">
        <Item size="xs" role="listitem" className="flex-nowrap items-start">
          <ItemContent className="min-w-0">
            <span title={path || undefined} className="break-words font-mono text-foreground">
              {path ? pathSegments(path) : "in-memory"}
            </span>
          </ItemContent>
          {path && (
            <ItemActions>
              <CopyButton
                value={path}
                write={copyTextToClipboard}
                tooltip="Copy"
                label="Copy database path"
              />
            </ItemActions>
          )}
        </Item>
        <ServerInfoRow label="Size" numeric value={formatBytes(storage.fileSizeBytes)} />
        <ServerInfoRow label="WAL" numeric value={formatBytes(storage.walSizeBytes)} />
        <ServerInfoRow label="Temp storage" numeric value={formatBytes(storage.tempStorageBytes)} />
        <ServerInfoRow
          label="Blocks"
          numeric
          value={`${storage.usedBlocks.toLocaleString("en-US")} used, ${storage.freeBlocks.toLocaleString("en-US")} free`}
        />
      </ServerInfoSection>
      <ServerInfoSection title="Retained data">
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
      </ServerInfoSection>
      <ServerInfoSection title="Sweep">
        <ServerInfoRow label="Retention" mono value={config.retention} />
        <ServerInfoRow
          label="Interval"
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
        <ServerInfoRow
          label="Last sweep"
          wrap
          value={
            sweep
              ? `${formatRelativeTime(sweep.startedAt)}, deleted ${sweep.deletedRows.toLocaleString("en-US")} rows in ${formatElapsedMs(sweep.durationMs)}`
              : "Not run yet"
          }
        />
        {sweep && sweep.maxSizeIterations > 0 && (
          <ServerInfoRow label="Max-size iterations" numeric value={sweep.maxSizeIterations} />
        )}
      </ServerInfoSection>
      {sweep?.error && <SweepErrorAlert error={sweep.error} />}
      <ServerInfoSection title="Tables">
        {storage.tables.map((table) => (
          <ServerInfoRow
            key={table.name}
            label={table.name}
            numeric
            value={
              <>
                {table.rows.toLocaleString("en-US")}
                <span className="font-sans text-muted-foreground"> rows</span>
              </>
            }
          />
        ))}
      </ServerInfoSection>
    </div>
  );
}
