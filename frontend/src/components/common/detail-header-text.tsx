import { HelpTooltip } from "./help-tooltip";
import { cn } from "@/lib/utils";

export function DetailHeaderText({
  children,
  primary = false,
}: {
  children: string;
  primary?: boolean;
}) {
  return (
    <HelpTooltip content={children}>
      <span
        tabIndex={0}
        className={cn(
          "min-w-0 truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
          primary
            ? "max-w-full font-semibold text-foreground"
            : "max-w-48 text-xs text-muted-foreground",
        )}
      >
        {children}
      </span>
    </HelpTooltip>
  );
}
