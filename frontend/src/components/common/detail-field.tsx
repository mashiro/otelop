import type { ReactNode } from "react";
import type { Tone } from "@/lib/tones";

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
    <div className="group/filter-field flex gap-2 text-sm">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={`break-all ${action ? "min-w-0 flex-1" : ""} ${mono ? "font-mono text-xs leading-5" : ""} ${tone ? `${toneClasses[tone]} font-semibold` : ""}`}
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
    <div className="group/filter-field">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h4>
        {action}
      </div>
      <div className="space-y-1.5 rounded-md bg-muted/50 p-2.5">{children}</div>
    </div>
  );
}
