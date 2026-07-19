interface ListOverflowNoticeProps {
  hiddenCount: number;
}

// Shared by trace-list.tsx/log-list.tsx/metric-list.tsx: all three cap how
// many rows they mount at once (see lib/list-render-cap.ts) and need an
// identical footer note when rows were left out — styled like
// empty-state.tsx's EmptyMatches rather than as a button, since there is
// nothing to click: the data is already loaded, just not rendered.
export function ListOverflowNotice({ hiddenCount }: ListOverflowNoticeProps) {
  if (hiddenCount <= 0) return null;

  return (
    <div className="border-t border-border/30 p-2 text-center text-xs text-muted-foreground">
      +{hiddenCount.toLocaleString()} more — narrow the time range or search to see them
    </div>
  );
}
