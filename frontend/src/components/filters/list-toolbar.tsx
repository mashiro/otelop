import type { ReactNode } from "react";

export function ListToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/50 px-4">
      {children}
    </div>
  );
}
