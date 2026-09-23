import { Card, CardContent } from "@/components/ui/card";
import type { ReactNode } from "react";
import { ListToolbar } from "@/components/filters/list-toolbar";

interface ListPanelProps {
  toolbar: ReactNode;
  toolbarClassName?: string;
  toolbarSecondary?: ReactNode;
  children: ReactNode;
}

export function ListPanel({
  toolbar,
  toolbarClassName,
  toolbarSecondary,
  children,
}: ListPanelProps) {
  return (
    <Card size="flush" className="@container/list h-full">
      <ListToolbar className={toolbarClassName} secondary={toolbarSecondary}>
        {toolbar}
      </ListToolbar>
      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</CardContent>
    </Card>
  );
}
