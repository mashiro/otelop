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
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  tone?: FieldTone;
}) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={`break-all ${mono ? "font-mono text-xs leading-5" : ""} ${tone ? `${toneClasses[tone]} font-semibold` : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <div className="space-y-1.5 rounded-md bg-muted/50 p-2.5">{children}</div>
    </div>
  );
}
