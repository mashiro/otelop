import { Card, CardHeader, CardTitle, CardAction, CardContent } from "@/components/ui/card";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

// FieldTone restricts Field's highlight color to the signal tones (trace,
// metric, log) — a Field never needs the status tones (success, warning, ...).
type FieldTone = Extract<Tone, "trace" | "metric" | "log">;

// Tailwind v4 can't scan dynamic class interpolation (e.g. `text-${tone}`),
// so each tone's classes must be listed literally here.
const toneClasses: Record<FieldTone, string> = {
  trace: "text-trace",
  metric: "text-metric",
  log: "text-log",
};

// Field/Section are the label/value building blocks shared by every signal's
// sidebar detail view (SpanDetail, LogDetail), so their layout stays visually
// consistent across signals.
export function Field({
  label,
  value,
  mono,
  tone,
  action,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  tone?: FieldTone;
  action?: ReactNode;
}) {
  return (
    <div className="group/filter-field flex items-start gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 flex-1 break-all",
          mono && "font-mono text-xs leading-5",
          tone && toneClasses[tone],
          tone && "font-semibold",
        )}
      >
        {value}
      </dd>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card size="sm">
      <CardHeader className="group/filter-field">
        <CardTitle>{title}</CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="min-w-0">
        <div className="flex flex-col gap-3">{children}</div>
      </CardContent>
    </Card>
  );
}

export function DetailFields({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <dl className="divide-y divide-border">{children}</dl>
    </Section>
  );
}
