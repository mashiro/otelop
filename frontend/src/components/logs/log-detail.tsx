import { HelpTooltip } from "@/components/common/help-tooltip";
import { useFilterByAction } from "@/hooks/use-filter-by-action";
import { Logs } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyJsonButton } from "@/components/common/copy-json-button";
import { formatTimestamp, isZeroId } from "@/lib/format";
import { KVSection } from "@/components/common/kv-section";
import { Field, Section } from "@/components/common/detail-field";
import { DetailSidebar } from "@/components/common/detail-sidebar";
import { Pill } from "@/components/common/pill";
import { severityTone } from "@/lib/tones";
import type { LogData } from "@/types/telemetry";

export function LogDetail({
  log,
  onClose,
  onNavigateToTrace,
  onShowContext,
}: {
  log: LogData;
  onClose: () => void;
  onNavigateToTrace: (id: string) => void;
  onShowContext: () => void;
}) {
  const { filterBy, filterAction } = useFilterByAction("logs");
  return (
    <DetailSidebar
      title="Log Details"
      tone="log"
      onClose={onClose}
      actions={<CopyJsonButton data={log} />}
    >
      <div className="space-y-2.5">
        <Field
          label="Timestamp"
          value={formatTimestamp(log.timestamp)}
          mono
          action={
            <HelpTooltip content="Show surrounding logs">
              <Button
                variant="ghost-muted"
                size="icon-xs"
                onClick={onShowContext}
                aria-label="Show surrounding logs"
              >
                <Logs />
              </Button>
            </HelpTooltip>
          }
        />
        <Field
          label="Severity"
          action={filterAction("severity_number", log.severityNumber)}
          value={
            <Pill tone={severityTone(log.severityText)} dot>
              {log.severityText || "UNSET"}
            </Pill>
          }
        />
        <Field
          label="Service"
          value={log.serviceName || "-"}
          action={filterAction("service_name", log.serviceName)}
        />
        {!isZeroId(log.traceId) && (
          <Field
            label="Trace ID"
            action={filterAction("trace_id", log.traceId)}
            mono
            value={
              <button
                className="text-trace underline decoration-trace/30 underline-offset-2 transition-colors hover:decoration-trace/60"
                onClick={() => onNavigateToTrace(log.traceId)}
              >
                {log.traceId}
              </button>
            }
          />
        )}
        {!isZeroId(log.spanId) && (
          <Field
            label="Span ID"
            value={log.spanId}
            mono
            action={filterAction("span_id", log.spanId)}
          />
        )}
      </div>

      <Section title="Body" action={filterAction("body", log.body)}>
        <div className="whitespace-pre-wrap break-all font-mono text-xs text-foreground/80">
          {log.body}
        </div>
      </Section>

      <KVSection
        title="Attributes"
        data={log.attributes}
        onFilter={(key, value) => filterBy(`attributes.${key}`, value)}
      />

      <KVSection
        title="Resource"
        data={log.resource}
        onFilter={(key, value) => filterBy(`resource.${key}`, value)}
      />
    </DetailSidebar>
  );
}
