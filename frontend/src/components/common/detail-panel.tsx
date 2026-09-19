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

// DetailPanel is the glass-card shell used by trace/metric detail views.
// It owns the outer card, header bar, close button, and layout so individual
// detail pages only supply header content, actions, and body.
export function DetailPanel({ header, actions, onClose, children }: DetailPanelProps) {
  useKeyboardShortcut("Escape", onClose);

  return (
    <div className="glass-card animate-fade-in flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close details"
            aria-keyshortcuts="Escape"
            title="Close details (Esc)"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
          {header}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
