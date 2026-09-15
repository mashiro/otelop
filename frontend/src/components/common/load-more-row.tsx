import { Button } from "@/components/ui/button";

interface LoadMoreRowProps {
  visible: boolean;
  loadingMore: boolean;
  onClick: () => void;
}

// Shared by trace-list.tsx, log-list.tsx and metric-list.tsx: slides
// hooks/use-render-window.ts's window one page further into history. The
// caller decides what a click actually does (slide over already-loaded rows,
// or fetch another page first) — see e.g. trace-list.tsx's handleLoadMore —
// this component only renders the affordance.
export function LoadMoreRow({ visible, loadingMore, onClick }: LoadMoreRowProps) {
  if (!visible) return null;

  return (
    <div className="flex justify-center p-2 text-muted-foreground">
      <Button variant="ghost" size="sm" onClick={onClick} disabled={loadingMore}>
        {loadingMore ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}
