import type { ReactNode } from "react";
import { Copy, Check } from "lucide-react";
import { HelpTooltip } from "@/components/common/help-tooltip";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";

// With children the button shows its label beside the icon (and swaps it for
// "Copied"); without, it is icon-only and needs an aria-label.
export function CopyButton<T>({
  value,
  write,
  tooltip,
  label,
  children,
}: {
  value: T;
  write: (value: T) => Promise<boolean>;
  tooltip: string;
  label?: string;
  children?: ReactNode;
}) {
  const { copied, copy } = useCopy(write);
  const icon = copied ? <Check className="text-success" /> : <Copy />;

  return (
    <HelpTooltip content={copied ? "Copied" : tooltip}>
      {children ? (
        <Button variant="ghost-muted" size="sm" onClick={() => copy(value)}>
          {icon}
          {copied ? "Copied" : children}
        </Button>
      ) : (
        <Button variant="ghost-muted" size="icon-xs" aria-label={label} onClick={() => copy(value)}>
          {icon}
        </Button>
      )}
    </HelpTooltip>
  );
}
