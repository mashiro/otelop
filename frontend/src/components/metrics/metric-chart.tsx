import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
import { filterPointsInDomain } from "@/lib/chart-time-range";
import { eventWindowDomain, type EventTimeWindow } from "@/lib/event-time-window";
import type { AggregateSeriesData } from "@/hooks/use-metric-aggregate-series";
import {
  buildAggregatedFacetSeries,
  buildRawGroupedSeries,
  type MetricChartPoint,
  type MetricSeries,
} from "@/lib/metric-chart-series";

const MARGIN = { top: 10, right: 20, bottom: 40, left: 72 };

function formatTick(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

type PointData = MetricChartPoint;

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
  // metric.dataPoints must already be the range-scoped data (metric-detail.tsx
  // passes { ...metric, dataPoints: rangeDataPoints } — see
  // use-metric-range-points.ts) — the same range-scoped data the stat tiles
  // above the chart sum, so the two can't desync (see metric-stats.ts's
  // computeStatTiles and MetricSummary).
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

export function MetricChart({ metric, facet, window, aggregatedSeries, onWindowChange }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <ParentSize>
          {({ width, height }) =>
            width > 0 && height > 0 ? (
              <ChartInner
                key={JSON.stringify([metric.serviceName, metric.name, facet?.attributes ?? null])}
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
}

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
  // null follows all series, including future arrivals; a set preserves an explicit selection.
  const [selectedKeys, setSelectedKeys] = useState<Set<string> | null>(null);
  const legendHintId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragStartRef = useRef<number | null>(null);
  const [dragSelection, setDragSelection] = useState<{ startX: number; endX: number } | null>(null);
  const unit = resolveMetricUnit(metric.name, metric.unit);

  // Facet active: render the server-summed series (the fix for the zigzag
  // bug — see use-metric-aggregate-series.ts) instead of grouping raw points
  // client-side. While the aggregated fetch is in flight or failed, render
  // nothing rather than falling back to the raw (unsummed) grouping, which
  // would reintroduce the zigzag.
  const series: MetricSeries[] = facet
    ? aggregatedSeries
      ? buildAggregatedFacetSeries(aggregatedSeries, facet, window)
      : []
    : buildRawGroupedSeries(metric.dataPoints, metric.type, window);

  // Kept unfiltered: the "No data points" branch reflects the raw metric,
  // not the current time-range window.
  const allPoints = series.flatMap((s) => s.points);

  const domain = eventWindowDomain(allPoints, window);

  const visibleSeries = series
    .filter((s) => selectedKeys === null || selectedKeys.has(s.key))
    .map((s) => ({
      ...s,
      points: domain ? filterPointsInDomain(s.points, domain) : s.points,
    }));

  const visiblePoints = visibleSeries.flatMap((s) => s.points);

  // The legend and its controls take 52px out of the measured height; the axis must be
  // laid out against the shrunken svg or its tick labels get clipped below it.
  const showLegend = series.length > 0;
  const svgHeight = showLegend ? height - 52 : height;

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = svgHeight - MARGIN.top - MARGIN.bottom;

  const xScale = domain
    ? scaleTime({ domain, range: [0, innerWidth] })
    : scaleTime({ domain: [new Date(), new Date()], range: [0, innerWidth] });

  let yMin = 0;
  let yMax = 1;
  for (const p of visiblePoints) {
    if (p.value < yMin) yMin = p.value;
    if (p.value > yMax) yMax = p.value;
  }
  const yPadding = (yMax - yMin) * 0.1 || 1;
  const yScale = scaleLinear({
    domain: [yMin - yPadding, yMax + yPadding],
    range: [innerHeight, 0],
  });

  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
    useTooltip<TooltipData>();

  function plotX(clientX: number): number | null {
    const svg = svgRef.current;
    if (!svg) return null;
    return clientX - svg.getBoundingClientRect().left - MARGIN.left;
  }

  function handlePointerDown(event: React.PointerEvent<SVGRectElement>) {
    if (event.button !== 0 || !domain) return;
    const x = plotX(event.clientX);
    if (x === null) return;
    const clampedX = Math.max(0, Math.min(innerWidth, x));
    dragStartRef.current = clampedX;
    setDragSelection({ startX: clampedX, endX: clampedX });
    hideTooltip();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<SVGRectElement>) {
    const startX = dragStartRef.current;
    if (startX === null) return;
    const x = plotX(event.clientX);
    if (x === null) return;
    setDragSelection({ startX, endX: Math.max(0, Math.min(innerWidth, x)) });
  }

  function finishDrag(event: React.PointerEvent<SVGRectElement>) {
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
  }

  function cancelDrag() {
    dragStartRef.current = null;
    setDragSelection(null);
  }

  // Show all series values at the nearest timestamp.
  function handleMouseMove(event: React.MouseEvent<SVGRectElement>) {
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
  }

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
            <g key={s.key} data-series={s.label}>
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
            className="cursor-crosshair touch-none outline-none"
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
          className="pointer-events-none z-50 max-w-80 rounded-lg border border-border bg-card px-3 py-2 shadow-sm backdrop-blur-md"
        >
          <div className="mb-1.5 font-mono text-3xs text-muted-foreground">
            {tooltipData.time.toLocaleTimeString()}
          </div>
          <div className="space-y-1">
            {tooltipData.rows.map((row) => (
              <div key={row.label} className="flex items-start gap-2 text-xs">
                <span
                  className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
                <span className="min-w-0 flex-1 break-words font-mono text-3xs leading-tight text-muted-foreground">
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

      {showLegend && (
        <div className="flex h-13 shrink-0 flex-col px-2" aria-label="Chart series">
          <div className="flex h-7 shrink-0 items-center gap-3 overflow-x-auto">
            {series.map((s) => (
              <Button
                key={s.key}
                variant="ghost"
                size="xs"
                aria-label={`Select ${s.label}`}
                aria-describedby={legendHintId}
                aria-pressed={selectedKeys === null || selectedKeys.has(s.key)}
                title={s.label}
                onClick={(event) => {
                  hideTooltip();
                  if (event.metaKey || event.ctrlKey) {
                    setSelectedKeys((previous) => {
                      const next = new Set(previous ?? series.map((item) => item.key));
                      if (next.has(s.key)) next.delete(s.key);
                      else next.add(s.key);
                      return next;
                    });
                  } else {
                    setSelectedKeys(new Set([s.key]));
                  }
                }}
              >
                <span
                  className="inline-block size-2 shrink-0 rounded-full border"
                  style={{
                    borderColor: s.color,
                    backgroundColor:
                      selectedKeys !== null && !selectedKeys.has(s.key) ? undefined : s.color,
                  }}
                />
                <span
                  className={cn(
                    "max-w-62.5 truncate font-mono",
                    selectedKeys !== null &&
                      !selectedKeys.has(s.key) &&
                      "text-muted-foreground line-through",
                  )}
                >
                  {s.label}
                </span>
              </Button>
            ))}
          </div>
          <div className="flex h-6 shrink-0 items-center gap-2">
            <span id={legendHintId} className="text-3xs text-muted-foreground">
              Click to isolate · ⌘ / Ctrl + click to toggle
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={selectedKeys === null}
              onClick={() => {
                hideTooltip();
                setSelectedKeys(null);
              }}
            >
              Show all
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
