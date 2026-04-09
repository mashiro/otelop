import { useMemo } from "react";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { ParentSize } from "@visx/responsive";
import type { MetricData } from "@/types/telemetry";

const MARGIN = { top: 10, right: 20, bottom: 40, left: 60 };

interface Props {
  metric: MetricData;
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
  const data = useMemo(
    () =>
      metric.dataPoints
        .map((dp) => ({ time: new Date(dp.timestamp), value: dp.value }))
        .sort((a, b) => a.time.getTime() - b.time.getTime()),
    [metric.dataPoints],
  );

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = height - MARGIN.top - MARGIN.bottom;

  const xScale = useMemo(
    () =>
      scaleTime({
        domain:
          data.length > 0 ? [data[0].time, data[data.length - 1].time] : [new Date(), new Date()],
        range: [0, innerWidth],
      }),
    [data, innerWidth],
  );

  const yScale = useMemo(() => {
    const values = data.map((d) => d.value);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    const padding = (max - min) * 0.1 || 1;
    return scaleLinear({
      domain: [min - padding, max + padding],
      range: [innerHeight, 0],
    });
  }, [data, innerHeight]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No data points
      </div>
    );
  }

  return (
    <svg width={width} height={height}>
      <Group left={MARGIN.left} top={MARGIN.top}>
        <AxisLeft
          scale={yScale}
          numTicks={5}
          tickLabelProps={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          stroke="var(--border)"
          tickStroke="var(--border)"
        />
        <AxisBottom
          scale={xScale}
          top={innerHeight}
          numTicks={5}
          tickLabelProps={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          stroke="var(--border)"
          tickStroke="var(--border)"
        />
        <LinePath
          data={data}
          x={(d) => xScale(d.time)}
          y={(d) => yScale(d.value)}
          stroke="var(--chart-1)"
          strokeWidth={2}
        />
        {data.map((d, i) => (
          <circle key={i} cx={xScale(d.time)} cy={yScale(d.value)} r={3} fill="var(--chart-1)" />
        ))}
      </Group>
    </svg>
  );
}
