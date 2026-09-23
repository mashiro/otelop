import { useState } from "react";
import { Cpu, Database, Gauge, Info } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HelpTooltip } from "@/components/common/help-tooltip";
import { useServerInfo } from "@/hooks/use-server-info";
import { useMediaQuery } from "@/hooks/use-media-query";
import { formatDateTime, formatElapsedMs } from "@/lib/format";
import { OverviewPanel } from "./server-info-overview";
import { StoragePanel } from "./server-info-storage";
import { RuntimePanel } from "./server-info-runtime";

export function ServerInfoDialog() {
  const [open, setOpen] = useState(false);
  const { data, isPending, isError } = useServerInfo(open);
  // A side nav would leave too little width for values on phones, so the tab
  // list only goes vertical from the sm breakpoint up.
  const wide = useMediaQuery("(min-width: 40rem)");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <HelpTooltip content="Server info">
        <DialogTrigger
          render={<Button aria-label="Server info" variant="ghost-muted" size="icon" />}
        >
          <Info />
        </DialogTrigger>
      </HelpTooltip>
      {/* A fixed height keeps the centered dialog from resizing, and the
          tab list from moving, when switching between tabs. */}
      <DialogContent className="flex h-128 max-h-11/12 flex-col sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            <span className="flex items-center gap-2">
              Server info
              {data && <Badge variant="secondary">{data.status.version}</Badge>}
            </span>
          </DialogTitle>
          {data && (
            <DialogDescription>
              Up {formatElapsedMs(data.status.uptimeMs)}, started{" "}
              {formatDateTime(data.status.startedAt)}
            </DialogDescription>
          )}
        </DialogHeader>
        {isPending && (
          <div role="status" className="flex flex-col gap-3">
            <span className="sr-only">Loading server info…</span>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {isError && (
          <Alert variant="destructive">
            <AlertDescription>Failed to load server info.</AlertDescription>
          </Alert>
        )}
        {data && (
          <Tabs
            orientation={wide ? "vertical" : "horizontal"}
            defaultValue="overview"
            className="min-h-0 flex-1 gap-6"
          >
            <TabsList variant="line" className="shrink-0">
              <TabsTrigger value="overview">
                <Gauge />
                Overview
              </TabsTrigger>
              <TabsTrigger value="storage">
                <Database />
                Storage
              </TabsTrigger>
              <TabsTrigger value="runtime">
                <Cpu />
                Runtime
              </TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="min-h-0 overflow-y-auto">
              <OverviewPanel status={data.status} />
            </TabsContent>
            <TabsContent value="storage" className="min-h-0 overflow-y-auto">
              <StoragePanel status={data.status} />
            </TabsContent>
            <TabsContent value="runtime" className="min-h-0 overflow-y-auto">
              <RuntimePanel status={data.status} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
