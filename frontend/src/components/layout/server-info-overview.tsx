import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CopyButton } from "@/components/common/copy-button";
import { endpointFor } from "@/lib/endpoint";
import { copyTextToClipboard } from "@/lib/export";
import { formatRelativeTime } from "@/lib/format";
import type { ServerInfoQuery } from "@/gql/graphql";
import { ServerInfoRow } from "./server-info-row";
import { ServerInfoSection, UsageMeter } from "./server-info-section";

type Status = ServerInfoQuery["status"];

export function OverviewPanel({ status }: { status: Status }) {
  const { storage, config } = status;
  const sweepError = storage.lastSweep?.error;
  const { hostname, host } = window.location;
  const endpoints = [
    { label: "OTLP gRPC", url: endpointFor(status.otlpGrpcAddr, hostname) },
    { label: "OTLP HTTP", url: endpointFor(status.otlpHttpAddr, hostname) },
    // The page's own host:port, not httpAddr's port: in dev the page is
    // served by Vite on another port, and a reverse proxy may remap it.
    { label: "Web UI", url: host },
  ];

  return (
    <div className="flex flex-col gap-4">
      {sweepError && (
        <Alert variant="destructive">
          <AlertTitle>Last sweep failed</AlertTitle>
          <AlertDescription>{sweepError}</AlertDescription>
        </Alert>
      )}
      <ServerInfoSection title="Endpoints">
        {endpoints.map(({ label, url }) => (
          <ServerInfoRow
            key={label}
            label={label}
            mono
            value={url}
            action={
              <CopyButton
                value={url}
                write={copyTextToClipboard}
                tooltip="Copy"
                label={`Copy ${label}`}
              />
            }
          />
        ))}
      </ServerInfoSection>
      <ServerInfoSection
        title="Resources"
        footer={
          <>
            Keeps {config.retention} of data
            {storage.nextSweepAt && `, next sweep ${formatRelativeTime(storage.nextSweepAt)}`}.
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
