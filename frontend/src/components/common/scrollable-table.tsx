import { cloneElement, useLayoutEffect, useRef, type ReactElement, type ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, type TableHeader } from "@/components/ui/table";

interface ScrollableTableProps {
  bounded?: boolean;
  spacing?: React.ComponentProps<typeof Table>["spacing"];
  header: ReactElement<React.ComponentProps<typeof TableHeader>>;
  children: ReactNode;
  before?: ReactNode;
  after?: ReactNode;
}

export function ScrollableTable({
  header,
  children,
  before,
  after,
  spacing = "comfortable",
  bounded = false,
}: ScrollableTableProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const heading = headerRef.current;
    if (!root || !heading) return;
    const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const bodyTable = viewport?.querySelector<HTMLTableElement>("table");
    const headerTable = heading.querySelector<HTMLTableElement>("table");
    if (!viewport || !bodyTable || !headerTable) return;

    const sync = () => {
      const widths = Array.from(
        bodyTable.querySelectorAll("thead th"),
        (cell) => cell.getBoundingClientRect().width,
      );
      headerTable.style.width = `${bodyTable.getBoundingClientRect().width}px`;
      headerTable.querySelectorAll("th").forEach((cell, index) => {
        cell.style.width = `${widths[index]}px`;
      });
      heading.scrollLeft = viewport.scrollLeft;
    };
    const observer = new ResizeObserver(sync);
    observer.observe(bodyTable);
    bodyTable.querySelectorAll("thead th").forEach((cell) => observer.observe(cell));
    viewport.addEventListener("scroll", sync, { passive: true });
    sync();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", sync);
    };
  }, []);

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {before}
      <div ref={headerRef} className="shrink-0 overflow-hidden border-b border-border/50">
        <Table spacing={spacing} className="table-fixed" aria-hidden="true">
          {cloneElement(header, { className: "static [&_tr]:border-0" })}
        </Table>
      </div>
      <ScrollArea
        className="min-h-0 min-w-0 flex-1"
        viewportClassName={bounded ? "max-h-80" : undefined}
      >
        <Table spacing={spacing}>
          {/* Keep native column sizing and accessible headers in the same table as the cells. */}
          {cloneElement(header, {
            className:
              "static [clip-path:inset(50%)] [&_tr]:border-0 [&_th]:h-0 [&_th]:py-0 [&_th]:leading-0",
          })}
          {children}
        </Table>
        {after}
      </ScrollArea>
    </div>
  );
}
