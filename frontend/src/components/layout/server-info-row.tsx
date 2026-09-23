import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// min-w-0 on the value is required for truncate to actually truncate
// instead of overflowing the card at real-world magnitudes.
export function ServerInfoRow({
  label,
  value,
  mono,
  numeric,
}: {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
  numeric?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">{label}</span>
      <span
        title={typeof value === "string" ? value : undefined}
        className={cn(
          "min-w-0 truncate text-right text-foreground",
          (mono || numeric) && "font-mono",
          numeric && "tabular-nums",
        )}
      >
        {value}
      </span>
    </div>
  );
}
