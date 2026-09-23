import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ServerInfoRow } from "./server-info-row";
import type { ServerInfoQuery } from "@/gql/graphql";

export function EndpointsCard({ status }: { status: ServerInfoQuery["status"] }) {
  return (
    <Card size="sm" className="min-w-0 md:col-span-2 lg:col-span-1">
      <CardHeader>
        <CardTitle>Endpoints</CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
