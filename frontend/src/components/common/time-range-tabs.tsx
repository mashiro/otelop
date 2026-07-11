import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHART_TIME_RANGES, type ChartTimeRange } from "@/lib/chart-time-range";

// Per-signal active-tab tint. Kept as a literal record (not a template
// interpolation) so Tailwind's static scanner can see every class name — see
// components/common/pill.tsx's toneBg for the same pattern.
const TONE_ACTIVE_CLS: Record<"trace" | "metric" | "log", string> = {
  trace: "data-active:bg-trace/15 data-active:text-trace",
  metric: "data-active:bg-metric/15 data-active:text-metric",
  log: "data-active:bg-log/15 data-active:text-log",
};

interface TimeRangeTabsProps {
  range: ChartTimeRange;
  onRangeChange: (range: ChartTimeRange) => void;
  tone: "trace" | "metric" | "log";
  // Trace/log lists sit in a compact toolbar row (the default, "sm"); the
  // metric detail view's control row has more room and uses the larger size.
  size?: "sm" | "md";
}

// Shared by trace-list.tsx, log-list.tsx, and metric-detail.tsx: the range
// selector Tabs block was pasted identically across all three, differing
// only in tone and size.
export function TimeRangeTabs({ range, onRangeChange, tone, size = "sm" }: TimeRangeTabsProps) {
  const listCls = size === "sm" ? "h-7 bg-muted/50" : "h-8 bg-muted/50";
  const triggerCls = size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-3 text-xs";

  return (
    <Tabs value={range} onValueChange={(v) => onRangeChange(v as ChartTimeRange)}>
      <TabsList className={listCls}>
        {CHART_TIME_RANGES.map((r) => (
          <TabsTrigger
            key={r.value}
            value={r.value}
            className={`${triggerCls} ${TONE_ACTIVE_CLS[tone]}`}
          >
            {r.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
