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
import type { SignalTone } from "@/lib/signals";

interface TimeRangeSelectProps {
  range: ChartTimeRange | null;
  onRangeChange: (range: ChartTimeRange) => void;
  tone: SignalTone;
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
        tone={tone}
        variant="muted"
        className="min-w-18"
        aria-label="Time range"
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
              {(value === "1h" || value === "24h" || value === "all") && <SelectSeparator />}
              <SelectItem value={value}>{label}</SelectItem>
            </Fragment>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
