export type ChartTimeRange = "1m" | "5m" | "15m" | "30m" | "1h" | "all";

export const CHART_TIME_RANGES: { value: ChartTimeRange; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "all", label: "All" },
];

const RANGE_MINUTES: Record<Exclude<ChartTimeRange, "all">, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
};

export function rangeToMs(range: ChartTimeRange): number | null {
  if (range === "all") return null;
  return RANGE_MINUTES[range] * 60_000;
}

// Anchored on the max data timestamp (not Date.now()) so the chart keeps
// showing the last window of data instead of going blank once data stops
// arriving.
export function timeRangeDomain(
  points: { time: Date }[],
  range: ChartTimeRange,
): [Date, Date] | null {
  if (points.length === 0) return null;

  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const p of points) {
    const t = p.time.getTime();
    if (t < minMs) minMs = t;
    if (t > maxMs) maxMs = t;
  }

  const rangeMs = rangeToMs(range);
  if (rangeMs === null) return [new Date(minMs), new Date(maxMs)];
  return [new Date(maxMs - rangeMs), new Date(maxMs)];
}

export function filterPointsInDomain<T extends { time: Date }>(
  points: T[],
  domain: [Date, Date],
): T[] {
  const [start, end] = domain;
  const startMs = start.getTime();
  const endMs = end.getTime();
  return points.filter((p) => {
    const t = p.time.getTime();
    return t >= startMs && t <= endMs;
  });
}
