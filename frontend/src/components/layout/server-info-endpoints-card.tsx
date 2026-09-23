import { Item, ItemHeader, ItemTitle, ItemContent } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ServerInfoRow } from "./server-info-row";
import type { ServerInfoQuery } from "@/gql/graphql";

export function EndpointsCard({ status }: { status: ServerInfoQuery["status"] }) {
  return (
    <Item variant="muted" className="min-w-0 flex-col items-stretch md:col-span-2 lg:col-span-1">
      <ItemHeader className="basis-auto flex-col items-start">
        <ItemTitle>Endpoints</ItemTitle>
      </ItemHeader>
      <ItemContent>
        <div className="flex flex-col gap-2">
          <ServerInfoRow label="Web UI" mono value={status.httpAddr} />
          <ServerInfoRow label="OTLP gRPC" mono value={status.otlpGrpcAddr} />
          <ServerInfoRow label="OTLP HTTP" mono value={status.otlpHttpAddr} />
          <ServerInfoRow
            label="Proxy"
            mono
            value={status.proxyUrl ? `${status.proxyUrl} (${status.proxyProtocol})` : "disabled"}
          />
          <Separator />
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{status.debug ? "debug on" : "debug off"}</Badge>
            <Badge variant="outline">{`log: ${status.logLevel}`}</Badge>
          </div>
        </div>
      </ItemContent>
    </Item>
  );
}
