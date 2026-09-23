import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/common/help-tooltip";
import { useServerInfo } from "@/hooks/use-server-info";
import { Info } from "lucide-react";
import { formatDateTime, formatElapsedMs } from "@/lib/format";
import { StorageCard } from "./server-info-storage-card";
import { SignalsCard } from "./server-info-signals-card";
import { RetentionCard } from "./server-info-retention-card";
import { TablesCard } from "./server-info-tables-card";
import { EndpointsCard } from "./server-info-endpoints-card";

export function ServerInfoDialog() {
  const [open, setOpen] = useState(false);
  const { data, isPending, isError } = useServerInfo(open);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <HelpTooltip content="Server info">
        <DialogTrigger
          render={<Button aria-label="Server info" variant="ghost-muted" size="icon-sm" />}
        >
          <Info />
        </DialogTrigger>
      </HelpTooltip>
      <DialogContent className="flex max-h-11/12 flex-col sm:max-w-5xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            <span className="flex items-center gap-2">
              Server info
              {data && <Badge variant="secondary">{data.status.version}</Badge>}
            </span>
          </DialogTitle>
          {data && (
            <DialogDescription>
              Up {formatElapsedMs(data.status.uptimeMs)} · started{" "}
              {formatDateTime(data.status.startedAt)}
            </DialogDescription>
          )}
        </DialogHeader>
        {/* Keep card rings visible inside the scroll container on short screens. */}
        <div className="-m-1 min-h-0 overflow-y-auto p-1">
          {isPending && (
            <div role="status" className="flex flex-col gap-3">
              <span className="sr-only">Loading server info…</span>
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-56 w-full" />
            </div>
          )}
          {isError && (
            <Alert variant="destructive">
              <AlertDescription>Failed to load server info.</AlertDescription>
            </Alert>
          )}
          {data && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <StorageCard status={data.status} />
                <SignalsCard status={data.status} />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                <RetentionCard config={data.status.config} storage={data.status.storage} />
                <TablesCard storage={data.status.storage} />
                <EndpointsCard status={data.status} />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
