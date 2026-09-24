import { CopyButton } from "@/components/common/copy-button";
import { endpointFor } from "@/lib/endpoint";
import { copyTextToClipboard } from "@/lib/export";
import { formatDateTime } from "@/lib/format";
import type { ServerInfoQuery } from "@/gql/graphql";
import { ServerInfoRow } from "./server-info-row";
import { ServerInfoSection, SweepErrorAlert, UsageMeter } from "./server-info-section";

type Status = ServerInfoQuery["status"];

export function OverviewPanel({ status }: { status: Status }) {
  const { storage, config } = status;
  const sweepError = storage.lastSweep?.error;
  const { hostname, host } = window.location;
  const endpoints = [
    { label: "OTLP gRPC", url: endpointFor(status.otlpGrpcAddr, hostname) },
    { label: "OTLP HTTP", url: endpointFor(status.otlpHttpAddr, hostname) },
    { label: "Web UI", url: host },
  ];

  return (
    <div className="flex flex-col gap-4">
      {sweepError && <SweepErrorAlert error={sweepError} />}
      <ServerInfoSection title="Endpoints">
        {endpoints.map(({ label, url }) => (
          <ServerInfoRow
            key={label}
            label={label}
            mono
            value={url ?? "—"}
            action={
              url && (
                <CopyButton
                  value={url}
                  write={copyTextToClipboard}
                  tooltip="Copy"
                  label={`Copy ${label}`}
                />
              )
            }
          />
        ))}
      </ServerInfoSection>
      <ServerInfoSection
        title="Resources"
        footer={
          <>
            Keeps {config.retention} of data
            {storage.nextSweepAt && `, next sweep at ${formatDateTime(storage.nextSweepAt)}`}.
          </>
        }
      >
        {storage.maxSizeBytes > 0 && (
          <UsageMeter label="Disk" used={storage.fileSizeBytes} limit={storage.maxSizeBytes} />
        )}
        {storage.memoryLimitBytes > 0 && (
          <UsageMeter
            label="Memory"
            used={storage.memoryUsageBytes}
            limit={storage.memoryLimitBytes}
          />
        )}
      </ServerInfoSection>
    </div>
  );
}
