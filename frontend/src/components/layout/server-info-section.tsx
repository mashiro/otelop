import type { ReactNode } from "react";
import { Section } from "@/components/common/detail-field";
import { Item, ItemActions, ItemContent, ItemDescription } from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/format-metric";

export function ServerInfoSection({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Section title={title}>
      {/* Not ItemGroup: its gap stacks on each Item's own padding, which
          spaces key/value rows like separate cards. */}
      <div role="list" className="flex flex-col">
        {children}
      </div>
      {footer && <p className="px-2.5 pt-1 text-xs text-muted-foreground">{footer}</p>}
    </Section>
  );
}

// Fixed label and figure columns keep every meter's bar the same length, so
// bars stacked in one section compare at a glance.
export function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = (used / limit) * 100;
  return (
    <Item size="xs" role="listitem" className="flex-nowrap">
      <ItemContent className="w-16 flex-none">
        <ItemDescription>{label}</ItemDescription>
      </ItemContent>
      <Progress
        aria-label={`${label} usage`}
        value={Math.min(100, pct)}
        className="min-w-0 flex-1"
      />
      <ItemActions className="w-36 justify-end">
        <span className="tabular-nums text-foreground">
          {formatBytes(used)} <span className="text-muted-foreground">of {formatBytes(limit)}</span>
        </span>
      </ItemActions>
    </Item>
  );
}
