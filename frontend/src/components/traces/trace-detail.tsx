import { useSearch, useNavigate, useElementScrollRestoration } from "@tanstack/react-router";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HelpTooltip } from "@/components/common/help-tooltip";
import { useTraceSelection, useRelatedSignals } from "@/hooks/use-signal-route";
import { useFilterByAction } from "@/hooks/use-filter-by-action";
import { FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyJsonButton } from "@/components/common/copy-json-button";
import { formatDuration, shortId, formatTimestamp } from "@/lib/format";
import { downloadJson } from "@/lib/export";
import { useTraceSpans } from "@/hooks/use-trace-spans";
import { SpanWaterfall } from "./span-waterfall";
import { KVSection } from "@/components/common/kv-section";
import { DetailPanel } from "@/components/common/detail-panel";
import { DetailSidebar } from "@/components/common/detail-sidebar";
import { Badge } from "@/components/ui/badge";
import { Field, Section } from "@/components/common/detail-field";
import type { SpanData, TraceData } from "@/types/telemetry";
import { SpanLinks } from "./span-links";
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
      header={
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="max-w-full truncate font-semibold text-foreground">
            {trace.rootSpan?.name ?? trace.spans[0]?.name}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{shortId(trace.traceId)}</span>
          {trace.spans.some((span) => span.statusCode === "Error") && (
            <Badge variant="soft" size="sm" tone="destructive">
              Error
            </Badge>
          )}
          <Badge variant="soft" size="sm" tone="trace">
            {trace.spanCount} spans
          </Badge>
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
              variant="ghost-muted"
              size="sm"
              onClick={() => downloadJson(trace, `trace-${trace.traceId.slice(0, 8)}.json`)}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </HelpTooltip>
          <HelpTooltip content="View related logs">
            <Button
              aria-label="View related logs"
              variant="ghost"
              tone="log"
              size="sm"
              onClick={() => navigateToLogs(trace.traceId)}
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
            onSelectSpan={(span) => {
              void setSelectedSpanId(span.spanId);
            }}
            onOpenLinks={(span) => {
              void setSelectedSpanId(span.spanId, "links");
            }}
            selectedSpan={selectedSpan}
            range={range}
          />
        </div>
        {selectedSpan && (
          <SpanInspector
            key={`${selectedSpan.traceId}/${selectedSpan.spanId}`}
            span={selectedSpan}
            traceStart={traceTimeline(trace).start}
            onClose={() => setSelectedSpanId(null)}
          />
        )}
      </div>
    </DetailPanel>
  );
}

function SpanInspector({
  span,
  traceStart,
  onClose,
}: {
  span: SpanData;
  traceStart: bigint;
  onClose: () => void;
}) {
  const { filterAction } = useFilterByAction("traces");
  const view = useSearch({
    from: "/traces/$traceId/spans/$spanId",
    select: (search) => search.spanTab ?? "details",
  });
  const navigate = useNavigate();
  const scrollEntry = useElementScrollRestoration({ id: "span-information" });
  return (
    <DetailSidebar
      title={span.name}
      tone="trace"
      onClose={onClose}
      closeLabel="Close span details"
      scrollable={false}
      actions={
        <>
          {filterAction("name", span.name)}
          <CopyJsonButton data={span} />
        </>
      }
    >
      <Tabs
        value={view}
        onValueChange={(value) =>
          void navigate({
            to: ".",
            search: (previous) => ({
              ...previous,
              link: undefined,
              spanTab: value === "links" || value === "referenced-by" ? value : undefined,
            }),
          })
        }
        className="min-h-0 flex-1 gap-0"
      >
        <div className="shrink-0 border-b border-border px-4 pb-1">
          <TabsList variant="line" aria-label="Span information">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="links">Links ({span.linkCount})</TabsTrigger>
            <TabsTrigger value="referenced-by">Referenced by</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent key={view} value={view} className="flex min-h-0 flex-col">
          <ScrollArea
            className="min-h-0 flex-1"
            viewportProps={{
              ref: (node) => {
                if (node && scrollEntry) node.scrollTop = scrollEntry.scrollY;
              },
              "data-scroll-restoration-id": "span-information",
              "aria-label": "Span information content",
            }}
          >
            <div className="space-y-5 px-4 py-3">
              {view === "details" ? (
                <SpanDetail span={span} traceStart={traceStart} />
              ) : (
                <SpanLinks span={span} incoming={view === "referenced-by"} />
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </DetailSidebar>
  );
}

function SpanDetail({ span, traceStart }: { span: SpanData; traceStart: bigint }) {
  const { filterBy, filterAction: action } = useFilterByAction("traces");

  return (
    <>
      {span.statusMessage && (
        <div className="group/filter-field flex items-start justify-between gap-2">
          <p className="min-w-0 break-words text-xs text-destructive">{span.statusMessage}</p>
          {action("status_message", span.statusMessage)}
        </div>
      )}
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
        <Field action={action("span_id", span.spanId)} label="Span ID" value={span.spanId} mono />
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
        <Field label="Start" value={formatDuration(Number(span.startEpochNs - traceStart))} mono />
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
    </>
  );
}
