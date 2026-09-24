import type { ReactNode } from "react";
import { Section } from "@/components/common/detail-field";
import { Item } from "@/components/ui/item";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
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

export function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const amount = `${formatBytes(used)} of ${formatBytes(limit)}`;
  return (
    <Item size="xs" role="listitem">
      <Progress
        value={Math.min(100, (used / limit) * 100)}
        getAriaValueText={(percent) => `${amount}, ${percent}`}
        className="w-full"
      >
        <ProgressLabel>{label}</ProgressLabel>
        <ProgressValue>
          {(percent) => (
            <span className="flex gap-2">
              {amount}
              <span className="text-foreground">{percent}</span>
            </span>
          )}
        </ProgressValue>
      </Progress>
    </Item>
  );
}
