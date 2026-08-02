import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { ParentSize } from "@visx/responsive";
import { curveMonotoneX } from "@visx/curve";
import { useTooltip, TooltipWithBounds } from "@visx/tooltip";
import type { MetricData } from "@/types/telemetry";
import { formatMetricValue } from "@/lib/format-metric";
import { resolveMetricUnit, type MetricFacet } from "@/lib/metric-catalog";
import { facetSeriesKey, resolveFacetGroupColorIndex } from "@/lib/metric-stats";
import { filterPointsInDomain } from "@/lib/chart-time-range";
import { eventWindowDomain, type EventTimeWindow } from "@/lib/event-time-window";
import type { AggregateSeriesData } from "@/hooks/use-metric-aggregate-series";
import { SERIES_COLORS, seriesColorIndexes } from "@/lib/metric-series-colors";

const MARGIN = { top: 10, right: 20, bottom: 40, left: 72 };

function formatTick(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface SeriesData {
  key: string;
  label: string;
  color: string;
  points: PointData[];
}

interface PointData {
  time: Date;
  value: number;
}

interface TooltipRow {
  label: string;
  color: string;
  value: number;
}

interface TooltipData {
  time: Date;
  rows: TooltipRow[];
}

interface Props {
  // metric.dataPoints is already the range-scoped data (metric-detail.tsx's
  // stableMetric sets it to rangeDataPoints — see use-metric-range-points.ts)
  // — the same range-scoped data the stat tiles above the chart sum, so the
  // two can't desync (see metric-stats.ts's computeStatTiles and
  // MetricSummary).
  metric: MetricData;
  // Facet to group series by; when null/undefined, series are keyed by the
  // full attribute combination (the "All" view).
  facet?: MetricFacet | null;
  window: EventTimeWindow;
  // Server-aggregated facet series (null when facet is null, or while a
  // fetch for the active facet/range hasn't landed yet).
  aggregatedSeries: AggregateSeriesData[] | null;
  onWindowChange: (window: EventTimeWindow) => void;
}

const MIN_DRAG_DISTANCE_PX = 4;

export function timeWindowFromDrag(
  domain: [Date, Date],
  startX: number,
  endX: number,
  width: number,
): EventTimeWindow | null {
  if (width <= 0 || Math.abs(endX - startX) < MIN_DRAG_DISTANCE_PX) return null;

  const left = Math.max(0, Math.min(width, Math.min(startX, endX)));
  const right = Math.max(0, Math.min(width, Math.max(startX, endX)));
  if (right - left < MIN_DRAG_DISTANCE_PX) return null;

  const domainStart = domain[0].getTime();
  const domainWidth = domain[1].getTime() - domainStart;
  if (domainWidth <= 0) return null;

  const from = new Date(domainStart + (left / width) * domainWidth);
  const to = new Date(domainStart + (right / width) * domainWidth);
  if (from.getTime() >= to.getTime()) return null;

  return { mode: "fixed", from: from.toISOString(), to: to.toISOString() };
}

/** Find the point in a series closest to a given time. */
function closestPoint(points: PointData[], targetMs: number): PointData | undefined {
  let best: PointData | undefined;
  let bestDist = Infinity;
  for (const p of points) {
    const d = Math.abs(p.time.getTime() - targetMs);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

// Memoized so a WS delivery that doesn't change the props MetricDetailBody
// passes down (rangeDataPoints/aggregatedSeries kept reference-stable via
// useStableArray — see use-metric-range-points.ts / use-metric-
// aggregate-series.ts) skips the SVG/axis/tooltip re-render entirely instead
// of repainting the whole chart on every message.
export const MetricChart = memo(function MetricChart({
  metric,
  facet,
  window,
  aggregatedSeries,
  onWindowChange,
}: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <ParentSize>
          {({ width, height }) =>
            width > 0 && height > 0 ? (
              <ChartInner
                metric={metric}
                facet={facet}
                aggregatedSeries={aggregatedSeries}
                window={window}
                onWindowChange={onWindowChange}
                width={width}
                height={height}
              />
            ) : null
          }
        </ParentSize>
      </div>
    </div>
  );
});

function ChartInner({
  metric,
  facet,
  aggregatedSeries,
  window,
  onWindowChange,
  width,
  height,
}: {
  metric: MetricData;
  facet?: MetricFacet | null;
  aggregatedSeries: AggregateSeriesData[] | null;
  window: EventTimeWindow;
  onWindowChange: (window: EventTimeWindow) => void;
  width: number;
  height: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragStartRef = useRef<number | null>(null);
  const [dragSelection, setDragSelection] = useState<{ startX: number; endX: number } | null>(null);
  const unit = resolveMetricUnit(metric.name, metric.unit);

  const series = useMemo(() => {
    // Facet active: render the server-summed series (the fix for the
    // zigzag bug — see use-metric-aggregate-series.ts) instead of grouping
    // raw points client-side. While the aggregated fetch is in flight or
    // failed, render nothing rather than falling back to the raw
    // (unsummed) grouping, which would reintroduce the zigzag.
    if (facet) {
      if (!aggregatedSeries) return [];
      const resolved = resolveFacetGroupColorIndex(aggregatedSeries, facet);
      return aggregatedSeries.map((s, i) => {
        const { label, colorIndex } = resolved[i]!;
        return {
          key: label,
          label,
          color: SERIES_COLORS[colorIndex],
          points: [...s.points]
            .map((p) => ({ time: new Date(p.timestamp), value: p.value }))
            .sort((a, b) => a.time.getTime() - b.time.getTime()),
        };
      });
    }

    const groups = new Map<string, PointData[]>();
    for (const dp of metric.dataPoints) {
      const key = facetSeriesKey(dp.attributes, facet);
      if (!groups.has(key)) groups.set(key, []);
      // dp.epochNs is already parsed (see lib/normalize.ts) — building the
      // chart's Date from it avoids re-parsing dp.timestamp as a string.
      groups.get(key)!.push({ time: new Date(Number(dp.epochNs / 1_000_000n)), value: dp.value });
    }
    const result: SeriesData[] = [];
    const colorIndexes = seriesColorIndexes([...groups.keys()]);
    let index = 0;
    for (const [key, points] of groups) {
      points.sort((a, b) => a.time.getTime() - b.time.getTime());
      result.push({
        key,
        label: key || "(no attributes)",
        color: SERIES_COLORS[colorIndexes[index]!],
        points,
      });
      index++;
    }
    return result;
  }, [metric.dataPoints, facet, aggregatedSeries]);

  // Kept unfiltered: the "No data points" branch reflects the raw metric,
  // not the current time-range window.
  const allPoints = useMemo(() => series.flatMap((s) => s.points), [series]);

  const domain = useMemo(() => eventWindowDomain(allPoints, window), [allPoints, window]);

  const visibleSeries = useMemo(
    () =>
      domain
        ? series.map((s) => ({ ...s, points: filterPointsInDomain(s.points, domain) }))
        : series,
    [series, domain],
  );

  const visiblePoints = useMemo(() => visibleSeries.flatMap((s) => s.points), [visibleSeries]);

  // The legend row takes 28px out of the measured height; the axis must be
  // laid out against the shrunken svg or its tick labels get clipped below it.
  const showLegend = series.length > 1;
  const svgHeight = showLegend ? height - 28 : height;

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = svgHeight - MARGIN.top - MARGIN.bottom;

  const xScale = useMemo(() => {
    if (domain) return scaleTime({ domain, range: [0, innerWidth] });
    return scaleTime({ domain: [new Date(), new Date()], range: [0, innerWidth] });
  }, [domain, innerWidth]);

  const yScale = useMemo(() => {
    let min = 0;
    let max = 1;
    for (const p of visiblePoints) {
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
    const padding = (max - min) * 0.1 || 1;
    return scaleLinear({
      domain: [min - padding, max + padding],
      range: [innerHeight, 0],
    });
  }, [visiblePoints, innerHeight]);

  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
    useTooltip<TooltipData>();

  const plotX = useCallback((clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    return clientX - svg.getBoundingClientRect().left - MARGIN.left;
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGRectElement>) => {
      if (event.button !== 0 || !domain) return;
      const x = plotX(event.clientX);
      if (x === null) return;
      const clampedX = Math.max(0, Math.min(innerWidth, x));
      dragStartRef.current = clampedX;
      setDragSelection({ startX: clampedX, endX: clampedX });
      hideTooltip();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [domain, hideTooltip, innerWidth, plotX],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGRectElement>) => {
      const startX = dragStartRef.current;
      if (startX === null) return;
      const x = plotX(event.clientX);
      if (x === null) return;
      setDragSelection({ startX, endX: Math.max(0, Math.min(innerWidth, x)) });
    },
    [innerWidth, plotX],
  );

  const finishDrag = useCallback(
    (event: React.PointerEvent<SVGRectElement>) => {
      const startX = dragStartRef.current;
      dragStartRef.current = null;
      setDragSelection(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (startX === null || !domain) return;
      const x = plotX(event.clientX);
      if (x === null) return;
      const nextWindow = timeWindowFromDrag(domain, startX, x, innerWidth);
      if (nextWindow) onWindowChange(nextWindow);
    },
    [domain, innerWidth, onWindowChange, plotX],
  );

  const cancelDrag = useCallback(() => {
    dragStartRef.current = null;
    setDragSelection(null);
  }, []);

  // Show all series values at the nearest timestamp.
  const handleMouseMove = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = event.clientX - rect.left - MARGIN.left;
      const mouseTime = xScale.invert(x).getTime();

      // Find the globally closest point, then collect all series at that timestamp.
      let nearestMs = 0;
      let nearestDist = Infinity;
      for (const s of visibleSeries) {
        const p = closestPoint(s.points, mouseTime);
        if (p) {
          const d = Math.abs(p.time.getTime() - mouseTime);
          if (d < nearestDist) {
            nearestDist = d;
            nearestMs = p.time.getTime();
          }
        }
      }

      const rows: TooltipRow[] = [];
      for (const s of visibleSeries) {
        const p = closestPoint(s.points, nearestMs);
        if (p) {
          rows.push({ label: s.label, color: s.color, value: p.value });
        }
      }

      if (rows.length > 0) {
        showTooltip({
          tooltipData: { time: new Date(nearestMs), rows },
          tooltipLeft: xScale(new Date(nearestMs)) + MARGIN.left,
          tooltipTop: event.clientY - rect.top,
        });
      }
    },
    [visibleSeries, xScale, showTooltip],
  );

  if (allPoints.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No data points
      </div>
    );
  }

  const nearestMs = tooltipData?.time.getTime();

  return (
    <div className="relative flex h-full flex-col">
      <svg ref={svgRef} width={width} height={svgHeight}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          {/* Grid lines */}
          {yScale.ticks(5).map((tick) => (
            <line
              key={tick}
              x1={0}
              x2={innerWidth}
              y1={yScale(tick)}
              y2={yScale(tick)}
              stroke="var(--border)"
              strokeWidth={0.5}
              opacity={0.5}
            />
          ))}

          <AxisLeft
            scale={yScale}
            numTicks={5}
            tickFormat={(v) => formatMetricValue(v as number, unit)}
            tickLabelProps={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              fill: "var(--muted-foreground)",
            }}
            stroke="var(--border)"
            tickStroke="var(--border)"
          />
          <AxisBottom
            scale={xScale}
            top={innerHeight}
            numTicks={Math.max(3, Math.floor(innerWidth / 120))}
            tickFormat={(v) => formatTick(v as Date)}
            tickLabelProps={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              fill: "var(--muted-foreground)",
            }}
            stroke="var(--border)"
            tickStroke="var(--border)"
          />

          {/* Lines and static points */}
          {visibleSeries.map((s) => (
            <g key={s.key}>
              {s.points.length >= 2 && (
                <LinePath
                  data={s.points}
                  x={(d) => xScale(d.time)}
                  y={(d) => yScale(d.value)}
                  stroke={s.color}
                  strokeWidth={2}
                  curve={curveMonotoneX}
                />
              )}
              {s.points.map((d, i) => (
                <circle
                  key={i}
                  cx={xScale(d.time)}
                  cy={yScale(d.value)}
                  r={3}
                  fill="var(--background)"
                  stroke={s.color}
                  strokeWidth={1.5}
                />
              ))}
            </g>
          ))}

          {dragSelection && (
            <rect
              x={Math.min(dragSelection.startX, dragSelection.endX)}
              y={0}
              width={Math.abs(dragSelection.endX - dragSelection.startX)}
              height={innerHeight}
              fill="var(--metric)"
              fillOpacity={0.14}
              stroke="var(--metric)"
              strokeWidth={1}
              pointerEvents="none"
            />
          )}

          {/* Hover crosshair + highlighted points */}
          {tooltipOpen && nearestMs != null && (
            <>
              <line
                x1={xScale(new Date(nearestMs))}
                x2={xScale(new Date(nearestMs))}
                y1={0}
                y2={innerHeight}
                stroke="var(--muted-foreground)"
                strokeWidth={1}
                strokeDasharray="3,3"
                opacity={0.4}
                pointerEvents="none"
              />
              {visibleSeries.map((s) => {
                const p = closestPoint(s.points, nearestMs);
                if (!p) return null;
                return (
                  <g key={s.key} pointerEvents="none">
                    <circle
                      cx={xScale(p.time)}
                      cy={yScale(p.value)}
                      r={6}
                      fill={s.color}
                      opacity={0.2}
                    />
                    <circle
                      cx={xScale(p.time)}
                      cy={yScale(p.value)}
                      r={4}
                      fill="var(--background)"
                      stroke={s.color}
                      strokeWidth={2}
                    />
                  </g>
                );
              })}
            </>
          )}

          {/* Invisible overlay to capture mouse (must be last for events) */}
          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            className="cursor-crosshair outline-none"
            style={{ touchAction: "none" }}
            onMouseMove={dragSelection ? undefined : handleMouseMove}
            onMouseLeave={hideTooltip}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={cancelDrag}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || dragStartRef.current === null) return;
              event.preventDefault();
              cancelDrag();
            }}
            tabIndex={-1}
            aria-label="Metric chart. Drag horizontally to select a time range. Press Escape to cancel."
          />
        </Group>
      </svg>

      {/* Tooltip */}
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds
          left={tooltipLeft}
          top={tooltipTop}
          unstyled
          applyPositionStyle
          className="pointer-events-none z-50 rounded-lg border border-border/50 bg-card px-3 py-2 shadow-sm backdrop-blur-md"
          style={{ maxWidth: 320 }}
        >
          <div className="mb-1.5 font-mono text-[10px] text-muted-foreground">
            {tooltipData.time.toLocaleTimeString()}
          </div>
          <div className="space-y-1">
            {tooltipData.rows.map((row) => (
              <div key={row.label} className="flex items-start gap-2 text-xs">
                <span
                  className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
                <span className="min-w-0 flex-1 break-words font-mono text-[10px] leading-tight text-muted-foreground">
                  {row.label}
                </span>
                <span className="shrink-0 font-mono font-semibold" style={{ color: row.color }}>
                  {formatMetricValue(row.value, unit)}
                </span>
              </div>
            ))}
          </div>
        </TooltipWithBounds>
      )}

      {/* Legend */}
      {showLegend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-2">
          {series.map((s) => (
            <div
              key={s.key}
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="max-w-[250px] truncate font-mono" title={s.label}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
