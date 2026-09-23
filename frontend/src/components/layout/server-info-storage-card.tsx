import type { ReactNode } from "react";
import { ServerInfoRow } from "./server-info-row";
import { Item, ItemHeader, ItemTitle, ItemDescription, ItemContent } from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/format-metric";
import type { ServerInfoQuery } from "@/gql/graphql";

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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="break-words font-mono text-sm tabular-nums text-foreground">{value}</div>
    </div>
  );
}

export function StorageCard({ status }: { status: Status }) {
  const { storage } = status;
  const path = status.config.storagePath;
  const pct = storage.maxSizeBytes > 0 ? (storage.fileSizeBytes / storage.maxSizeBytes) * 100 : 0;

  return (
    <Item variant="muted" className="min-w-0 flex-col items-stretch">
      <ItemHeader className="basis-auto flex-col items-start">
        <ItemTitle>Storage</ItemTitle>
        <ItemDescription title={path || undefined}>
          <span className="break-words font-mono">{path ? pathSegments(path) : "in-memory"}</span>
        </ItemDescription>
      </ItemHeader>
      <ItemContent>
        <div className="flex flex-col gap-3">
          {storage.maxSizeBytes > 0 && (
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-foreground">
                  <span>{formatBytes(storage.fileSizeBytes)}</span>{" "}
                  <span className="text-muted-foreground">
                    of {formatBytes(storage.maxSizeBytes)}
                  </span>
                </span>
                <span className="tabular-nums text-muted-foreground">{pct.toFixed(0)}%</span>
              </div>
              <Progress aria-label="Storage usage" value={Math.min(100, pct)} className="mt-2" />
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="WAL" value={formatBytes(storage.walSizeBytes)} />
            <Stat label="Memory" value={formatBytes(storage.memoryUsageBytes)} />
            <Stat label="Temp storage" value={formatBytes(storage.tempStorageBytes)} />
          </div>
          <ServerInfoRow
            label="Blocks"
            numeric
            value={`${storage.usedBlocks.toLocaleString("en-US")} used · ${storage.freeBlocks.toLocaleString("en-US")} free`}
          />
        </div>
      </ItemContent>
    </Item>
  );
}
