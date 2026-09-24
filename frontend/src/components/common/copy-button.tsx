import type { ReactNode } from "react";
import { Copy, Check, X } from "lucide-react";
import { HelpTooltip } from "@/components/common/help-tooltip";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";

// An icon-only button has no visible text, so it must carry a label.
type CopyButtonProps<T> = {
  value: T;
  write: (value: T) => Promise<boolean>;
  tooltip: string;
} & ({ label: string; children?: never } | { children: ReactNode; label?: never });

export function CopyButton<T>({ value, write, tooltip, label, children }: CopyButtonProps<T>) {
  const { status, copy } = useCopy(write);
  const icon =
    status === "copied" ? (
      <Check className="text-success" />
    ) : status === "failed" ? (
      <X className="text-destructive" />
    ) : (
      <Copy />
    );
  const message = status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : null;

  return (
    <>
      <HelpTooltip content={message ?? tooltip}>
        {label !== undefined ? (
          <Button
            variant="ghost-muted"
            size="icon-xs"
            aria-label={label}
            onClick={() => copy(value)}
          >
            {icon}
          </Button>
        ) : (
          <Button variant="ghost-muted" size="sm" onClick={() => copy(value)}>
            {icon}
            {message ?? children}
          </Button>
        )}
      </HelpTooltip>
      {/* The result otherwise only shows in a hover tooltip and the icon. */}
      <span role="status" className="sr-only">
        {message}
      </span>
    </>
  );
}
