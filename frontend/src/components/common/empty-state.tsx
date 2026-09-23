import type { SignalConfig } from "@/lib/signals";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { SignalIcon } from "./signal-icon";

export function EmptyState({ signal }: { signal: SignalConfig }) {
  return (
    <Card size="flush" className="h-full">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="signal" tone={signal.token} aria-hidden="true">
            <SignalIcon signal={signal} />
          </EmptyMedia>
          <EmptyTitle>{signal.emptyTitle}</EmptyTitle>
          <EmptyDescription>{signal.emptyHint}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Card>
  );
}

export function EmptyMatches({ label }: { label: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyDescription>No matching {label}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
