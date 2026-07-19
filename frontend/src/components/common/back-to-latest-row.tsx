import { Button } from "@/components/ui/button";

interface BackToLatestRowProps {
  count: number;
  // What's hidden above the window, e.g. "newer — back to latest" (traces/
  // logs, newest-first) or "earlier — back to top" (metrics, name-sorted) —
  // see trace-list.tsx/log-list.tsx/metric-list.tsx for which each passes.
  label: string;
  onClick: () => void;
}

// Same visual shape as load-more-row.tsx (border, outline button, full
// width), placed above the table instead of below it: hooks/use-render-window.ts's
// window can be scrolled into history via "Load more", and this is the way
// back once it has — count is the row's `newerCount`.
export function BackToLatestRow({ count, label, onClick }: BackToLatestRowProps) {
  if (count <= 0) return null;

  return (
    <div className="border-b border-border/30 p-2">
      <Button variant="outline" size="sm" className="w-full" onClick={onClick}>
        {count.toLocaleString()} {label}
      </Button>
    </div>
  );
}
