import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/common/help-tooltip";
import { useCopyText } from "@/hooks/use-copy";

export function CopyTextButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopyText();

  return (
    <HelpTooltip content={copied ? "Copied" : "Copy"}>
      <Button variant="ghost-muted" size="icon-xs" aria-label={label} onClick={() => copy(text)}>
        {copied ? <Check className="text-success" /> : <Copy />}
      </Button>
    </HelpTooltip>
  );
}
