import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopyJson } from "@/hooks/use-copy";

export function CopyJsonButton({ data, size = "sm" }: { data: unknown; size?: "sm" | "xs" }) {
  const { copied, copy } = useCopyJson();
  const iconSize = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <HelpTooltip content="Copy as JSON">
      <Button
        variant="ghost"
        size={size === "xs" ? "sm" : size}
        onClick={() => copy(data)}
        className={`gap-1 text-muted-foreground hover:text-foreground ${size === "xs" ? "text-[10px]" : "text-xs"}`}
      >
        {copied ? <Check className={`${iconSize} text-success`} /> : <Copy className={iconSize} />}
        {copied ? "Copied" : "JSON"}
      </Button>
    </HelpTooltip>
  );
}
