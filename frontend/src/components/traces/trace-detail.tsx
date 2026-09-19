import { HelpTooltip } from "@/components/ui/help-tooltip";
import { useSignalQuery, useTraceSelection, useRelatedSignals } from "@/hooks/use-signal-route";
import { draftTerm } from "@/lib/log-filter";
import { traceFields } from "@/lib/trace-search";
import { AddFilterButton } from "@/components/filters/add-filter-button";
import { X, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyJsonButton } from "@/components/ui/copy-json-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDuration, shortId, formatTimestamp } from "@/lib/format";
import { downloadJson } from "@/lib/export";
import { useTraceSpans } from "@/hooks/use-trace-spans";
import { SpanWaterfall } from "./span-waterfall";
import { KVSection } from "@/components/ui/kv-section";
import { DetailPanel } from "@/components/common/detail-panel";
import { Pill } from "@/components/common/pill";
import { Field, Section } from "@/components/common/detail-field";
import type { SpanData, TraceData } from "@/types/telemetry";
import { TraceOverview } from "./trace-overview";
import { traceTimeline, type TimelineRange } from "./trace-timeline";
import { useState } from "react";

export function TraceDetail() {
  const { trace, selectTrace: setSelected } = useTraceSelection();

  // The trace list only loads summaries (see use-initial-load.ts); backfill
  // this trace's full span data the moment its detail view is open.
  useTraceSpans(trace);

  if (!trace) return null;
  return <TraceDetailView key={trace.traceId} trace={trace} onClose={() => setSelected(null)} />;
}

function TraceDetailView({ trace, onClose }: { trace: TraceData; onClose: () => void }) {
  const { navigateToLogs } = useRelatedSignals();
  const { spanId: selectedSpanId, selectSpan: setSelectedSpanId } = useTraceSelection();
  const selectedSpan = trace.spans.find((span) => span.spanId === selectedSpanId) ?? null;
  const [range, setRange] = useState<TimelineRange>([0, 100]);

  return (
    <DetailPanel
      onClose={onClose}
      onEscape={selectedSpanId ? () => setSelectedSpanId(null) : onClose}
      header={
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="max-w-full truncate font-semibold text-foreground">
            {trace.rootSpan?.name ?? trace.spans[0]?.name}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{shortId(trace.traceId)}</span>
          {trace.spans.some((span) => span.statusCode === "Error") && (
            <Pill tone="destructive">Error</Pill>
          )}
          <Pill tone="trace">{trace.spanCount} spans</Pill>
          <span className="text-xs text-muted-foreground">
            {new Set(trace.spans.map((span) => span.serviceName)).size} services
          </span>
          <span className="font-mono text-xs text-trace">{formatDuration(trace.duration)}</span>
        </div>
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
      <TraceOverview trace={trace} range={range} onRangeChange={setRange} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <SpanWaterfall
            trace={trace}
            onSelectSpan={(span) => setSelectedSpanId(span.spanId)}
            selectedSpan={selectedSpan}
            range={range}
          />
        </div>
        {selectedSpan && (
          <div className="h-[45%] min-h-0 shrink-0 border-t border-border/50 xl:h-auto xl:w-[360px] xl:border-t-0 xl:border-l">
            <SpanDetail
              key={selectedSpan.spanId}
              span={selectedSpan}
              traceStart={traceTimeline(trace).start}
              onClose={() => setSelectedSpanId(null)}
            />
          </div>
        )}
      </div>
    </DetailPanel>
  );
}

function SpanDetail({
  span,
  traceStart,
  onClose,
}: {
  span: SpanData;
  traceStart: bigint;
  onClose: () => void;
}) {
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
        <div className="flex items-center gap-1">
          <CopyJsonButton data={span} size="xs" />
          <Button
            aria-label="Close span details"
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="animate-slide-up-fade space-y-5 p-4">
          <div className="space-y-2">
            <div className="group/filter-field flex items-start justify-between gap-2">
              <h4 className="min-w-0 break-words text-sm font-semibold">{span.name}</h4>
              {action("name", span.name)}
            </div>
            {span.statusMessage && (
              <div className="group/filter-field flex items-start justify-between gap-2">
                <p className="min-w-0 break-words text-xs text-destructive">{span.statusMessage}</p>
                {action("status_message", span.statusMessage)}
              </div>
            )}
          </div>
          <div className="space-y-2.5">
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
              value={span.statusCode === "Unset" ? "Not set" : span.statusCode}
            />
            <Field
              label="Start"
              value={formatDuration(Number(span.startEpochNs - traceStart))}
              mono
            />
            <Field label="End" value={formatDuration(Number(span.endEpochNs - traceStart))} mono />
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
          <KVSection
            title="Resource"
            data={span.resource}
            onFilter={(key, value) => filterBy(`resource.${key}`, value)}
          />
          <Section title={`Events (${span.events.length})`}>
            {span.events.length === 0 && (
              <p className="text-xs text-muted-foreground">No events recorded.</p>
            )}
            {span.events.map((event, index) => (
              <Section key={index} title={event.name}>
                <p className="font-mono text-xs text-muted-foreground">
                  {formatTimestamp(event.timestamp)}
                </p>
                <KVSection title="Attributes" data={event.attributes} />
              </Section>
            ))}
          </Section>
        </div>
      </ScrollArea>
    </div>
  );
}
