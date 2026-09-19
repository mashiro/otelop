import { HelpTooltip } from "@/components/common/help-tooltip";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopyJson } from "@/hooks/use-copy";

export function CopyJsonButton({ data }: { data: unknown }) {
  const { copied, copy } = useCopyJson();

  return (
    <HelpTooltip content="Copy as JSON">
      <Button variant="ghost-muted" size="sm" onClick={() => copy(data)}>
        {copied ? <Check className="text-success" /> : <Copy />}
        {copied ? "Copied" : "JSON"}
      </Button>
    </HelpTooltip>
  );
}
