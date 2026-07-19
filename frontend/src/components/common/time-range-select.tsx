import { Fragment } from "react";
import { Clock3 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CHART_TIME_RANGES, type ChartTimeRange } from "@/lib/chart-time-range";

const SELECT_TONE_CLS = {
  trace: "focus-visible:border-trace/60 focus-visible:ring-trace/20",
  metric: "focus-visible:border-metric/60 focus-visible:ring-metric/20",
  log: "focus-visible:border-log/60 focus-visible:ring-log/20",
} as const;

interface TimeRangeSelectProps {
  range: ChartTimeRange | null;
  onRangeChange: (range: ChartTimeRange) => void;
  tone: keyof typeof SELECT_TONE_CLS;
  size?: "sm" | "md";
}

const CUSTOM_ITEM = { value: "custom", label: "Custom" };

export function TimeRangeSelect({ range, onRangeChange, tone, size = "sm" }: TimeRangeSelectProps) {
  // Base UI's Select.Value shows the selected item's raw value by default
  // (unlike Radix, it doesn't read the rendered SelectItem's label) — items
  // tells it which label to render for each value instead.
  const items = range === null ? [CUSTOM_ITEM, ...CHART_TIME_RANGES] : CHART_TIME_RANGES;

  return (
    <Select
      items={items}
      value={range ?? "custom"}
      onValueChange={(value) => {
        if (value && value !== "custom") onRangeChange(value as ChartTimeRange);
      }}
    >
      <SelectTrigger
        size={size === "sm" ? "sm" : "default"}
        aria-label="Time range"
        className={`min-w-18 bg-muted/50 text-xs font-medium ${SELECT_TONE_CLS[tone]}`}
      >
        <Clock3 className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="min-w-24">
        <SelectGroup>
          {range === null && (
            <>
              <SelectItem value="custom">Custom</SelectItem>
              <SelectSeparator />
            </>
          )}
          {CHART_TIME_RANGES.map(({ value, label }) => (
            <Fragment key={value}>
              {(value === "1h" || value === "all") && <SelectSeparator />}
              <SelectItem value={value}>{label}</SelectItem>
            </Fragment>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
