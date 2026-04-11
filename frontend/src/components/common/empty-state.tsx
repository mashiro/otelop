import type { SignalConfig } from "@/lib/signals";
import { SignalIcon } from "./signal-icon";

interface EmptyStateProps {
  signal: SignalConfig;
}

export function EmptyState({ signal }: EmptyStateProps) {
  return (
    <div className="glass-card flex h-full items-center justify-center">
      <div className="animate-slide-up-fade flex flex-col items-center gap-4">
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-2xl ${signal.classes.bgLight}`}
        >
          <SignalIcon signal={signal} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground/70">{signal.emptyTitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{signal.emptyHint}</p>
        </div>
      </div>
    </div>
  );
}

interface EmptyMatchesProps {
  label: string;
}

export function EmptyMatches({ label }: EmptyMatchesProps) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-sm text-muted-foreground">No matching {label}</p>
    </div>
  );
}
