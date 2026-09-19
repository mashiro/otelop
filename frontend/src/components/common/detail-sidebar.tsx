import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/tones";

type SidebarTone = Extract<Tone, "trace" | "metric" | "log">;

// Tailwind v4 can't scan dynamic class interpolation (e.g. `text-${tone}`),
// so each tone's classes must be listed literally here — see
// common/detail-field.tsx's toneClasses.
const titleToneClasses: Record<SidebarTone, string> = {
  trace: "text-trace",
  metric: "text-metric",
  log: "text-log",
};

interface DetailSidebarProps {
  title: string;
  tone: SidebarTone;
  // Rendered before the close button (e.g. a CopyJsonButton).
  actions?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  children: ReactNode;
}

// DetailSidebar is the shell shared by the span/log/data-point sidebars
// nested inside a trace or list view: the sized container (stacked below
// `xl`, right-hand rail above it), header, and scrollable body used to
// drift between the three call sites, so unify them here.
export function DetailSidebar({
  title,
  tone,
  actions,
  onClose,
  closeLabel = "Close details",
  children,
}: DetailSidebarProps) {
  // Nested inside a DetailPanel that also listens for Escape (see
  // detail-panel.tsx): capture phase makes this, the innermost visible
  // layer, see and consume the key first, so one Escape closes only the
  // sidebar instead of both levels at once.
  useKeyboardShortcut("Escape", onClose, { capture: true });

  return (
    <div className="h-[45%] min-h-0 shrink-0 border-t border-border/50 xl:h-auto xl:w-105 xl:border-t-0 xl:border-l">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-2">
          <h3 className={cn("text-sm font-semibold", titleToneClasses[tone])}>{title}</h3>
          <div className="flex items-center gap-1">
            {actions}
            <Button
              variant="ghost-muted"
              size="icon-xs"
              onClick={onClose}
              aria-label={closeLabel}
              aria-keyshortcuts="Escape"
              title={`${closeLabel} (Esc)`}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="animate-slide-up-fade space-y-5 p-4">{children}</div>
        </ScrollArea>
      </div>
    </div>
  );
}
