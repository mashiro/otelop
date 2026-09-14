import type { ReactNode } from "react";
import { ListToolbar } from "@/components/filters/list-toolbar";

interface ListPanelProps {
  toolbar: ReactNode;
  toolbarClassName?: string;
  toolbarSecondary?: ReactNode;
  children: ReactNode;
}

// ListPanel is the glass-card + toolbar shell shared by every signal list view.
// The body is left to the caller because each signal has its own list layout.
export function ListPanel({
  toolbar,
  toolbarClassName,
  toolbarSecondary,
  children,
}: ListPanelProps) {
  return (
    <div className="glass-card flex h-full flex-col overflow-hidden">
      <ListToolbar className={toolbarClassName} secondary={toolbarSecondary}>
        {toolbar}
      </ListToolbar>
      {children}
    </div>
  );
}
