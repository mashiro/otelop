import { useAtomValue, useSetAtom } from "jotai";
import { X, FileText, Copy, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { selectedTraceAtom, navigateToLogsAtom } from "@/stores/telemetry";
import { formatDuration, shortID } from "@/lib/format";
import { SpanWaterfall } from "./span-waterfall";
import { KVSection } from "@/components/ui/kv-section";
import type { SpanData } from "@/types/telemetry";
import { useCopyJson } from "@/hooks/use-copy";
import { downloadJson } from "@/lib/export";
import { useState } from "react";

export function TraceDetail() {
  const trace = useAtomValue(selectedTraceAtom);
  const setSelected = useSetAtom(selectedTraceAtom);
  const navigateToLogs = useSetAtom(navigateToLogsAtom);
  const [selectedSpan, setSelectedSpan] = useState<SpanData | null>(null);
  const { copied, copy } = useCopyJson();

  if (!trace) return null;

  return (
    <div className="glass-card animate-fade-in flex h-full flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSelected(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
          <span className="font-semibold text-foreground">
            {trace.rootSpan?.name ?? trace.spans[0]?.name}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{shortID(trace.traceID)}</span>
          <span className="rounded-full bg-trace/15 px-2 py-0.5 text-[11px] font-medium text-trace">
            {trace.spanCount} spans
          </span>
          <span className="font-mono text-xs text-trace">{formatDuration(trace.duration)}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => copy(trace)}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            title="Copy trace as JSON"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "JSON"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadJson(trace, `trace-${trace.traceID.slice(0, 8)}.json`)}
            className="text-muted-foreground hover:text-foreground"
            title="Download trace as JSON"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigateToLogs(trace.traceID)}
            className="gap-1.5 text-xs text-log hover:text-log"
            title="View related logs"
          >
            <FileText className="h-3.5 w-3.5" />
            Logs
          </Button>
        </div>
      </div>

      {/* Content */}
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
    </div>
  );
}

function SpanDetail({ span, onClose }: { span: SpanData; onClose: () => void }) {
  return (
    <ScrollArea className="h-full">
      <div className="animate-slide-up-fade space-y-5 p-4">
        <div className="flex items-center justify-between">
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

        <div className="space-y-2.5">
          <Field label="Name" value={span.name} />
          <Field label="Service" value={span.serviceName} />
          <Field label="Span ID" value={span.spanID} mono />
          <Field label="Parent" value={span.parentSpanID || "(root)"} mono />
          <Field label="Kind" value={span.kind} />
          <Field label="Status" value={span.statusCode} />
          {span.statusMessage && <Field label="Message" value={span.statusMessage} />}
          <Field label="Duration" value={formatDuration(span.duration)} mono highlight />
        </div>

        <KVSection title="Attributes" data={span.attributes} />

        {span.events.length > 0 && (
          <Section title="Events">
            {span.events.map((e, i) => (
              <div key={i} className="text-xs">
                <span className="font-medium text-foreground/80">{e.name}</span>
              </div>
            ))}
          </Section>
        )}

        <KVSection title="Resource" data={span.resource} />
      </div>
    </ScrollArea>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <div className="space-y-1.5 rounded-md bg-muted/50 p-2.5">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={`break-all ${mono ? "font-mono text-xs leading-5" : ""} ${highlight ? "text-trace font-semibold" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
