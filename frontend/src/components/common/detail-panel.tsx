import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DetailPanelProps {
  // Left-hand side of the header, after the close button: typically title +
  // inline metadata/badges.
  header: ReactNode;
  // Right-hand side of the header: action buttons (copy, download, navigate…).
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function DetailPanel({ header, actions, onClose, children }: DetailPanelProps) {
  useKeyboardShortcut("Escape", onClose);

  return (
    <Card size="flush" className="h-full">
      <CardHeader className="shrink-0">
        <div className="flex w-full items-center justify-between border-b border-border/50 px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Button
              variant="ghost-muted"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close details"
              aria-keyshortcuts="Escape"
              title="Close details (Esc)"
            >
              <X className="h-4 w-4" />
            </Button>
            {header}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</CardContent>
    </Card>
  );
}
