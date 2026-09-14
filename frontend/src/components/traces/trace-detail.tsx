import { HelpTooltip } from "@/components/ui/help-tooltip";
import { useSignalQuery, useTraceSelection, useRelatedSignals } from "@/hooks/use-signal-route";
import { draftTerm } from "@/lib/log-filter";
import { traceFields } from "@/lib/trace-search";
import { AddFilterButton } from "@/components/filters/add-filter-button";
import { X, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyJsonButton } from "@/components/ui/copy-json-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDuration, shortId } from "@/lib/format";
import { downloadJson } from "@/lib/export";
import { useTraceSpans } from "@/hooks/use-trace-spans";
import { SpanWaterfall } from "./span-waterfall";
import { KVSection } from "@/components/ui/kv-section";
import { DetailPanel } from "@/components/common/detail-panel";
import { Pill } from "@/components/common/pill";
import { Field, Section } from "@/components/common/detail-field";
import type { SpanData } from "@/types/telemetry";
import { useState } from "react";

export function TraceDetail() {
  const { trace, selectTrace: setSelected } = useTraceSelection();
  const { navigateToLogs } = useRelatedSignals();
  const [selectedSpan, setSelectedSpan] = useState<SpanData | null>(null);
  // The trace list only loads summaries (see use-initial-load.ts); backfill
  // this trace's full span data the moment its detail view is open.
  useTraceSpans(trace);

  if (!trace) return null;

  return (
    <DetailPanel
      onClose={() => setSelected(null)}
      header={
        <>
          <span className="font-semibold text-foreground">
            {trace.rootSpan?.name ?? trace.spans[0]?.name}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{shortId(trace.traceId)}</span>
          <Pill tone="trace">{trace.spanCount} spans</Pill>
          <span className="font-mono text-xs text-trace">{formatDuration(trace.duration)}</span>
        </>
      }
      actions={
        <>
          <CopyJsonButton data={trace} />
          <HelpTooltip content="Download trace as JSON">
            <Button
              aria-label="Download trace as JSON"
              variant="ghost"
              size="sm"
              onClick={() => downloadJson(trace, `trace-${trace.traceId.slice(0, 8)}.json`)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </HelpTooltip>
          <HelpTooltip content="View related logs">
            <Button
              aria-label="View related logs"
              variant="ghost"
              size="sm"
              onClick={() => navigateToLogs(trace.traceId)}
              className="gap-1.5 text-xs text-log hover:text-log"
            >
              <FileText className="h-3.5 w-3.5" />
              Logs
            </Button>
          </HelpTooltip>
        </>
      }
    >
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <SpanWaterfall trace={trace} onSelectSpan={setSelectedSpan} selectedSpan={selectedSpan} />
        </div>
        {selectedSpan && (
          <div className="w-[420px] border-l border-border/50">
            <SpanDetail span={selectedSpan} onClose={() => setSelectedSpan(null)} />
          </div>
        )}
      </div>
    </DetailPanel>
  );
}

function SpanDetail({ span, onClose }: { span: SpanData; onClose: () => void }) {
  const { addFilter } = useSignalQuery("traces");
  const filterBy = (key: string, value: unknown) =>
    addFilter(
      draftTerm(
        {
          key,
          operator: value == null ? "not_exists" : typeof value === "object" ? "exists" : "is",
          value:
            typeof value === "string" || typeof value === "number" || typeof value === "boolean"
              ? String(value)
              : "",
        },
        traceFields,
      ),
    );
  const action = (key: string, value: unknown) => (
    <AddFilterButton label={`Filter by ${key}`} onClick={() => filterBy(key, value)} />
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2">
        <h3 className="text-sm font-semibold text-trace">Span Details</h3>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="animate-slide-up-fade space-y-5 p-4">
          <div className="space-y-2.5">
            <Field action={action("name", span.name)} label="Name" value={span.name} />
            <Field
              action={action("service_name", span.serviceName)}
              label="Service"
              value={span.serviceName}
            />
            <Field
              label="Trace ID"
              value={span.traceId}
              mono
              action={action("trace_id", span.traceId)}
            />
            <Field
              action={action("span_id", span.spanId)}
              label="Span ID"
              value={span.spanId}
              mono
            />
            <Field
              action={action("parent_span_id", span.parentSpanId || undefined)}
              label="Parent"
              value={span.parentSpanId || "(root)"}
              mono
            />
            <Field action={action("kind", span.kind)} label="Kind" value={span.kind} />
            <Field
              action={action("status_code", span.statusCode)}
              label="Status"
              value={span.statusCode}
            />
            {span.statusMessage && (
              <Field
                action={action("status_message", span.statusMessage)}
                label="Message"
                value={span.statusMessage}
              />
            )}
            <Field
              action={action("duration_ms", span.duration / 1e6)}
              label="Duration"
              value={formatDuration(span.duration)}
              mono
              tone="trace"
            />
          </div>

          <KVSection
            title="Attributes"
            data={span.attributes}
            onFilter={(key, value) => filterBy(`attributes.${key}`, value)}
          />

          {span.events.length > 0 && (
            <Section title="Events">
              {span.events.map((e, i) => (
                <div key={i} className="text-xs">
                  <span className="font-medium text-foreground/80">{e.name}</span>
                </div>
              ))}
            </Section>
          )}

          <KVSection
            title="Resource"
            data={span.resource}
            onFilter={(key, value) => filterBy(`resource.${key}`, value)}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
