import { Button } from "@/components/ui/button";
import type { SignalListPage } from "@/hooks/use-signal-list-page";

// Shared by trace-list.tsx and log-list.tsx: both mount a SignalListPage
// pagination hook (use-trace-list-page.ts / use-log-list-page.ts) and want an
// identical Load more footer once the range holds another page.
export function LoadMoreRow({ hasMore, loadingMore, loadMore }: SignalListPage) {
  if (!hasMore) return null;

  return (
    <div className="border-t border-border/30 p-2">
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={loadMore}
        disabled={loadingMore}
      >
        {loadingMore ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}
