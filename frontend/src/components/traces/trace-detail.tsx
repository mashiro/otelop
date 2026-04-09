import { useAtomValue, useSetAtom } from "jotai";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { selectedTraceAtom } from "@/stores/telemetry";
import { formatDuration, shortID } from "@/lib/format";
import { SpanWaterfall } from "./span-waterfall";
import type { SpanData } from "@/types/telemetry";
import { useState } from "react";

export function TraceDetail() {
  const trace = useAtomValue(selectedTraceAtom);
  const setSelected = useSetAtom(selectedTraceAtom);
  const [selectedSpan, setSelectedSpan] = useState<SpanData | null>(null);

  if (!trace) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
            <X className="h-4 w-4" />
          </Button>
          <span className="font-semibold">{trace.rootSpan?.name ?? trace.spans[0]?.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{shortID(trace.traceID)}</span>
          <Badge variant="secondary">{trace.spanCount} spans</Badge>
          <span className="font-mono text-xs">{formatDuration(trace.duration)}</span>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <SpanWaterfall trace={trace} onSelectSpan={setSelectedSpan} selectedSpan={selectedSpan} />
        </div>
        {selectedSpan && (
          <div className="w-[400px] border-l">
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
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Span Details</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        </div>
        <dl className="space-y-2 text-sm">
          <Field label="Name" value={span.name} />
          <Field label="Service" value={span.serviceName} />
          <Field label="Span ID" value={span.spanID} mono />
          <Field label="Parent" value={span.parentSpanID || "(root)"} mono />
          <Field label="Kind" value={span.kind} />
          <Field label="Status" value={span.statusCode} />
          {span.statusMessage && <Field label="Message" value={span.statusMessage} />}
          <Field label="Duration" value={formatDuration(span.duration)} mono />
        </dl>
        {Object.keys(span.attributes).length > 0 && (
          <div>
            <h4 className="font-semibold text-xs text-muted-foreground mb-1">Attributes</h4>
            <div className="space-y-1">
              {Object.entries(span.attributes).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0">{k}</span>
                  <span className="font-mono break-all">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {span.events.length > 0 && (
          <div>
            <h4 className="font-semibold text-xs text-muted-foreground mb-1">Events</h4>
            <div className="space-y-1">
              {span.events.map((e, i) => (
                <div key={i} className="text-xs">
                  <span className="font-medium">{e.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {Object.keys(span.resource).length > 0 && (
          <div>
            <h4 className="font-semibold text-xs text-muted-foreground mb-1">Resource</h4>
            <div className="space-y-1">
              {Object.entries(span.resource).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0">{k}</span>
                  <span className="font-mono break-all">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground shrink-0 w-20">{label}</dt>
      <dd className={mono ? "font-mono break-all" : "break-all"}>{value}</dd>
    </div>
  );
}
