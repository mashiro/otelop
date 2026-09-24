import type { ReactNode } from "react";
import { Item, ItemActions, ItemContent, ItemDescription } from "@/components/ui/item";
import { cn } from "@/lib/utils";

// min-w-0 on the value is required for truncate to actually truncate
// instead of overflowing the dialog at real-world magnitudes.
export function ServerInfoRow({
  label,
  value,
  mono,
  numeric,
  wrap,
  action,
}: {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
  numeric?: boolean;
  // For prose-like values (e.g. a sweep summary) that must stay fully
  // readable; the title tooltip that backs truncation never shows on touch.
  wrap?: boolean;
  action?: ReactNode;
}) {
  return (
    <Item size="xs" role="listitem" className="flex-nowrap">
      <ItemContent className="flex-none">
        <ItemDescription>
          <span className="flex items-center gap-1.5">{label}</span>
        </ItemDescription>
      </ItemContent>
      <ItemActions className="ml-auto min-w-0">
        <span
          title={typeof value === "string" ? value : undefined}
          className={cn(
            "min-w-0 text-right text-foreground",
            wrap ? "break-words" : "truncate",
            (mono || numeric) && "font-mono",
            numeric && "tabular-nums",
          )}
        >
          {value}
        </span>
        {action}
      </ItemActions>
    </Item>
  );
}
