import type { ServerInfoQuery } from "@/gql/graphql";
import { ServerInfoRow } from "./server-info-row";
import { ServerInfoSection } from "./server-info-section";

export function RuntimePanel({ status }: { status: ServerInfoQuery["status"] }) {
  return (
    <div className="flex flex-col gap-4">
      <ServerInfoSection title="Settings">
        <ServerInfoRow
          label="Proxy"
          mono
          value={status.proxyUrl ? `${status.proxyUrl} (${status.proxyProtocol})` : "disabled"}
        />
        <ServerInfoRow label="Debug" mono value={status.debug ? "on" : "off"} />
        <ServerInfoRow label="Log level" mono value={status.logLevel} />
      </ServerInfoSection>
    </div>
  );
}
