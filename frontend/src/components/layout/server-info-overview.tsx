import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CopyButton } from "@/components/common/copy-button";
import { reachableEndpoint } from "@/lib/endpoint";
import { copyTextToClipboard } from "@/lib/export";
import { formatRelativeTime } from "@/lib/format";
import type { ServerInfoQuery } from "@/gql/graphql";
import { ServerInfoRow } from "./server-info-row";
import { ServerInfoSection, UsageMeter } from "./server-info-section";

type Status = ServerInfoQuery["status"];

export function OverviewPanel({ status }: { status: Status }) {
  const { storage, config } = status;
  const sweepError = storage.lastSweep?.error;
  const { hostname, origin } = window.location;
  const endpoints = [
    { label: "OTLP gRPC", url: reachableEndpoint(status.otlpGrpcAddr, hostname) },
    { label: "OTLP HTTP", url: reachableEndpoint(status.otlpHttpAddr, hostname) },
    // The page's own origin is by definition reachable; httpAddr may be a
    // wildcard bind or, in dev, sit behind the Vite proxy on another port.
    { label: "Web UI", url: origin },
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
