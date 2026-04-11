import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/tones";

const toneBg: Record<Tone, string> = {
  success: "bg-success/15 text-success",
  destructive: "bg-destructive/15 text-destructive",
  warning: "bg-warning/15 text-warning",
  primary: "bg-primary/15 text-primary",
  muted: "bg-muted text-muted-foreground",
  trace: "bg-trace/15 text-trace",
  metric: "bg-metric/15 text-metric",
  log: "bg-log/15 text-log",
};

const toneDot: Record<Tone, string> = {
  success: "bg-success",
  destructive: "bg-destructive",
  warning: "bg-warning",
  primary: "bg-primary",
  muted: "bg-muted-foreground/40",
  trace: "bg-trace",
  metric: "bg-metric",
  log: "bg-log",
};

interface PillProps {
  tone: Tone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

// Pill is the compact rounded badge used for statuses, severities, and type
// markers across signals. Pass `dot` to show a small colored leading indicator
// (typical for status and severity chips).
export function Pill({ tone, dot = false, className, children }: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        toneBg[tone],
        className,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", toneDot[tone])} />}
      {children}
    </span>
  );
}
