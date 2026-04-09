import { useCallback, useMemo } from "react";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { ParentSize } from "@visx/responsive";
import { curveMonotoneX } from "@visx/curve";
import { useTooltip, TooltipWithBounds, defaultStyles } from "@visx/tooltip";
import { localPoint } from "@visx/event";
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

interface TooltipData {
  seriesLabel: string;
  color: string;
  point: PointData;
}

interface Props {
  metric: MetricData;
}

/** Serialize attributes to a stable string key for grouping. */
function attrKey(attrs: Record<string, unknown>): string {
  const entries = Object.entries(attrs).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}=${String(v)}`).join(", ");
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

  // Find the closest data point to the mouse across all series.
  const handleMouseMove = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const point = localPoint(event);
      if (!point) return;
      const x = point.x - MARGIN.left;
      const mouseTime = xScale.invert(x).getTime();

      let closest: TooltipData | null = null;
      let closestDist = Infinity;

      for (const s of series) {
        for (const p of s.points) {
          const dist = Math.abs(p.time.getTime() - mouseTime);
          if (dist < closestDist) {
            closestDist = dist;
            closest = { seriesLabel: s.label, color: s.color, point: p };
          }
        }
      }

      if (closest) {
        showTooltip({
          tooltipData: closest,
          tooltipLeft: xScale(closest.point.time) + MARGIN.left,
          tooltipTop: yScale(closest.point.value) + MARGIN.top,
        });
      }
    },
    [series, xScale, yScale, showTooltip],
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

  return (
    <div className="relative flex h-full flex-col">
      <svg width={width} height={svgHeight}>
        <defs>
          <filter id="line-glow">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
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

          {/* Lines and points */}
          {series.map((s) => (
            <g key={s.key}>
              <LinePath
                data={s.points}
                x={(d) => xScale(d.time)}
                y={(d) => yScale(d.value)}
                stroke={s.color}
                strokeWidth={2}
                curve={curveMonotoneX}
                filter="url(#line-glow)"
                strokeOpacity={0.8}
              />
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

          {/* Highlighted point on hover */}
          {tooltipOpen && tooltipData && (
            <>
              {/* Vertical crosshair */}
              <line
                x1={xScale(tooltipData.point.time)}
                x2={xScale(tooltipData.point.time)}
                y1={0}
                y2={innerHeight}
                stroke="var(--muted-foreground)"
                strokeWidth={1}
                strokeDasharray="3,3"
                opacity={0.4}
              />
              {/* Glow ring */}
              <circle
                cx={xScale(tooltipData.point.time)}
                cy={yScale(tooltipData.point.value)}
                r={6}
                fill={tooltipData.color}
                opacity={0.2}
              />
              <circle
                cx={xScale(tooltipData.point.time)}
                cy={yScale(tooltipData.point.value)}
                r={4}
                fill="var(--background)"
                stroke={tooltipData.color}
                strokeWidth={2}
              />
            </>
          )}

          {/* Invisible overlay rect to capture mouse events */}
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
          style={{
            ...defaultStyles,
            background: "oklch(0.16 0.012 260)",
            border: "1px solid oklch(1 0 0 / 10%)",
            borderRadius: "6px",
            color: "oklch(0.93 0.005 260)",
            padding: "6px 10px",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            lineHeight: "1.5",
            boxShadow: "0 4px 20px oklch(0 0 0 / 30%)",
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 600, color: tooltipData.color }}>
            {tooltipData.point.value.toLocaleString()}
            {metric.unit ? ` ${metric.unit}` : ""}
          </div>
          <div style={{ color: "oklch(0.55 0.01 260)" }}>
            {tooltipData.point.time.toLocaleTimeString()}
          </div>
          {series.length > 1 && (
            <div
              style={{
                color: "oklch(0.55 0.01 260)",
                marginTop: "2px",
                maxWidth: "200px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {tooltipData.seriesLabel}
            </div>
          )}
        </TooltipWithBounds>
      )}

      {/* Legend */}
      {showLegend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-2">
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="max-w-[200px] truncate font-mono">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { attrKey };
