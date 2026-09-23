import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CopyTextButton } from "@/components/common/copy-text-button";
import { formatRelativeTime } from "@/lib/format";
import type { ServerInfoQuery } from "@/gql/graphql";
import { ServerInfoRow } from "./server-info-row";
import { ServerInfoSection, UsageMeter } from "./server-info-section";

type Status = ServerInfoQuery["status"];

export function OverviewPanel({ status }: { status: Status }) {
  const { storage, config } = status;
  const sweepError = storage.lastSweep?.error;
  const endpoints = [
    { label: "OTLP gRPC", addr: status.otlpGrpcAddr },
    { label: "OTLP HTTP", addr: status.otlpHttpAddr },
    { label: "Web UI", addr: status.httpAddr },
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
        {endpoints.map(({ label, addr }) => (
          <ServerInfoRow
            key={label}
            label={label}
            mono
            value={addr}
            action={<CopyTextButton text={addr} label={`Copy ${label}`} />}
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
