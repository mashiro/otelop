import type { ServerInfoQuery } from "@/gql/graphql";
import { ServerInfoRow } from "./server-info-row";
import { ServerInfoSection } from "./server-info-section";

export function RuntimePanel({ status }: { status: ServerInfoQuery["status"] }) {
  return (
    <div className="flex flex-col gap-4">
      <ServerInfoSection title="Settings">
        <ServerInfoRow label="Debug" mono value={status.debug ? "on" : "off"} />
        <ServerInfoRow label="Log level" mono value={status.logLevel} />
      </ServerInfoSection>
      <ServerInfoSection
        title="Exporters"
        footer={status.exporters.length === 0 ? "None configured" : undefined}
      >
        {status.exporters.map((exporter) => (
          <ServerInfoRow
            key={exporter.name}
            label={exporter.name}
            mono
            value={`${exporter.url} (${exporter.protocol})`}
          />
        ))}
      </ServerInfoSection>
    </div>
  );
}
