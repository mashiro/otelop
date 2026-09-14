import { HelpTooltip } from "@/components/ui/help-tooltip";
import { ListFilterPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AddFilterButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <HelpTooltip content={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="pointer-events-none shrink-0 text-muted-foreground opacity-0 hover:text-foreground group-hover/filter-field:pointer-events-auto group-hover/filter-field:opacity-100 group-focus-within/filter-field:pointer-events-auto group-focus-within/filter-field:opacity-100"
        aria-label={label}
        onClick={onClick}
      >
        <ListFilterPlus className="size-3" />
      </Button>
    </HelpTooltip>
  );
}
