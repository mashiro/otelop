import type { ReactNode } from "react";
import { Copy, Check } from "lucide-react";
import { HelpTooltip } from "@/components/common/help-tooltip";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";

// An icon-only button has no visible text, so it must carry a label.
type CopyButtonProps<T> = {
  value: T;
  write: (value: T) => Promise<boolean>;
  tooltip: string;
} & ({ children: ReactNode; label?: never } | { label: string; children?: never });

export function CopyButton<T>({ value, write, tooltip, label, children }: CopyButtonProps<T>) {
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
