import type { ReactNode } from "react";

export function ListToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2">{children}</div>
  );
}
