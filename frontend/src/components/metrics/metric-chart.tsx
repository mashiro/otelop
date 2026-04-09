import { useCallback, useMemo, useRef } from "react";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { ParentSize } from "@visx/responsive";
import { curveMonotoneX } from "@visx/curve";
import { useTooltip, TooltipWithBounds } from "@visx/tooltip";
import type { MetricData } from "@/types/telemetry";

const MARGIN = { top: 10, right: 20, bottom: 40, left: 60 };

const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

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
  metric: MetricData;
}

/** Serialize attributes to a stable string key for grouping. */
function attrKey(attrs: Record<string, unknown>): string {
  const entries = Object.entries(attrs).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
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

export function MetricChart({ metric }: Props) {
  return (
    <ParentSize>
      {({ width, height }) =>
        width > 0 && height > 0 ? (
          <ChartInner metric={metric} width={width} height={height} />
        ) : null
      }
    </ParentSize>
  );
}

function ChartInner({ metric, width, height }: Props & { width: number; height: number }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const series = useMemo(() => {
    const groups = new Map<string, PointData[]>();
    for (const dp of metric.dataPoints) {
      const key = attrKey(dp.attributes);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ time: new Date(dp.timestamp), value: dp.value });
    }
    const result: SeriesData[] = [];
    let i = 0;
    for (const [key, points] of groups) {
      points.sort((a, b) => a.time.getTime() - b.time.getTime());
      result.push({
        key,
        label: key || "(no attributes)",
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        points,
      });
      i++;
    }
    return result;
  }, [metric.dataPoints]);

  const allPoints = useMemo(() => series.flatMap((s) => s.points), [series]);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const xScale = useMemo(
    () =>
      scaleTime({
        domain:
          allPoints.length > 0
            ? [
                new Date(Math.min(...allPoints.map((p) => p.time.getTime()))),
                new Date(Math.max(...allPoints.map((p) => p.time.getTime()))),
              ]
            : [new Date(), new Date()],
        range: [0, innerWidth],
      }),
    [allPoints, innerWidth],
  );

  const yScale = useMemo(() => {
    const values = allPoints.map((d) => d.value);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    const padding = (max - min) * 0.1 || 1;
    return scaleLinear({
      domain: [min - padding, max + padding],
      range: [innerHeight, 0],
    });
  }, [allPoints, innerHeight]);

  const {
    showTooltip,
    hideTooltip,
    tooltipData,
    tooltipLeft,
    tooltipTop,
    tooltipOpen,
  } = useTooltip<TooltipData>();

  // Show all series values at the nearest timestamp.
  const handleMouseMove = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = event.clientX - rect.left - MARGIN.left;
      const mouseTime = xScale.invert(x).getTime();

      // Find the globally closest timestamp across all series.
      let nearestMs = 0;
      let nearestDist = Infinity;
      for (const s of series) {
        for (const p of s.points) {
          const d = Math.abs(p.time.getTime() - mouseTime);
          if (d < nearestDist) {
            nearestDist = d;
            nearestMs = p.time.getTime();
          }
        }
      }

      // Collect each series' value closest to that timestamp.
      const rows: TooltipRow[] = [];
      for (const s of series) {
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
    [series, xScale, showTooltip],
  );

  if (allPoints.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No data points
      </div>
    );
  }

  const showLegend = series.length > 1;
  const svgHeight = showLegend ? height - 28 : height;
  const nearestMs = tooltipData?.time.getTime();

  return (
    <div className="relative flex h-full flex-col">
      <svg ref={svgRef} width={width} height={svgHeight}>
        <defs />
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
            numTicks={5}
            tickLabelProps={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              fill: "var(--muted-foreground)",
            }}
            stroke="var(--border)"
            tickStroke="var(--border)"
          />

          {/* Lines and static points */}
          {series.map((s) => (
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
              {series.map((s) => {
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
            onMouseMove={handleMouseMove}
            onMouseLeave={hideTooltip}
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
          className="pointer-events-none z-50 rounded-lg border border-border/50 bg-card px-3 py-2 shadow-xl backdrop-blur-md"
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
                  {row.value.toLocaleString()}
                  {metric.unit ? ` ${metric.unit}` : ""}
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
            <div key={s.key} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="max-w-[250px] truncate font-mono" title={s.label}>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { attrKey };
