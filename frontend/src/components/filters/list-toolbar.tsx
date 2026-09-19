import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function ListToolbar({
  children,
  className,
  secondary,
}: {
  children: ReactNode;
  className?: string;
  secondary?: ReactNode;
}) {
  return (
    <>
      <div
        className={cn(
          "flex shrink-0 items-center gap-3 border-b border-border/50 px-4 py-2",
          secondary && "border-b-transparent",
          className,
        )}
      >
        {children}
      </div>
      {secondary && <div className="shrink-0 border-b border-border/50 px-4 pb-2">{secondary}</div>}
    </>
  );
}
