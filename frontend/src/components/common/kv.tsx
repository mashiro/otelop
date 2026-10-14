import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function KV({ k, v }: { k: string; v: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const collapsible = v.length > 100;

  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs">
      <div className="break-all font-medium text-muted-foreground">{k}</div>
      <div
        id={id}
        className={cn(
          "whitespace-pre-wrap break-all font-mono leading-relaxed text-foreground",
          collapsible && !expanded && "line-clamp-2",
        )}
      >
        {v}
      </div>
      {collapsible && (
        <Button
          type="button"
          variant="ghost-muted"
          size="xs"
          className="self-start"
          aria-expanded={expanded}
          aria-controls={id}
          aria-label={`${expanded ? "Show less" : "Show more"} ${k}`}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
  );
}
