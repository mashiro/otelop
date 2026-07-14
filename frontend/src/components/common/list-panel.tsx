import type { ReactNode } from "react";
import { ListToolbar } from "@/components/filters/list-toolbar";

interface ListPanelProps {
  toolbar: ReactNode;
  children: ReactNode;
}

// ListPanel is the glass-card + toolbar shell shared by every signal list view.
// The body is left to the caller because each signal has its own list layout.
export function ListPanel({ toolbar, children }: ListPanelProps) {
  return (
    <div className="glass-card flex h-full flex-col overflow-hidden">
      <ListToolbar>{toolbar}</ListToolbar>
      {children}
    </div>
  );
}
